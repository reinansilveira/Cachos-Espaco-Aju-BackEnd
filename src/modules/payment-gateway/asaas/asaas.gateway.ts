import {
  BadGatewayException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { timingSafeEqual } from 'crypto';
import {
  GatewayChargeInput,
  GatewayCustomerInput,
  GatewayPayment,
  GatewayPixQrCode,
  GatewayWebhookEvent,
  PaymentGateway,
} from '../payment-gateway.types';
import {
  AsaasPayment,
  mapAsaasPayment,
  parseAsaasWebhook,
} from './asaas-webhook.parser';

const SANDBOX_URL = 'https://api-sandbox.asaas.com/v3';

@Injectable()
export class AsaasGateway implements PaymentGateway {
  readonly provider = 'asaas';
  private readonly logger = new Logger(AsaasGateway.name);
  private readonly http: ReturnType<typeof axios.create>;
  private readonly apiKey?: string;
  private readonly webhookToken?: string;

  constructor(config: ConfigService) {
    this.apiKey = config.get<string>('ASAAS_API_KEY');
    this.webhookToken = config.get<string>('ASAAS_WEBHOOK_TOKEN');
    this.http = axios.create({
      baseURL: config.get<string>('ASAAS_BASE_URL') || SANDBOX_URL,
      timeout: 15_000,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  async createCustomer(input: GatewayCustomerInput) {
    const body = {
      name: input.name,
      cpfCnpj: input.cpfCnpj,
      email: input.email ?? undefined,
      mobilePhone: input.phone ?? undefined,
      externalReference: input.externalReference,
      notificationDisabled: false,
    };

    try {
      const data = await this.request<{ id: string }>(
        'post',
        '/customers',
        body,
      );
      return { id: data.id };
    } catch (error) {
      // Telefone é opcional no Asaas: um número mal cadastrado no perfil não
      // pode impedir a cliente de pagar.
      if (
        (error as { gatewayCode?: string }).gatewayCode !==
        'invalid_mobilePhone'
      ) {
        throw error;
      }
      const data = await this.request<{ id: string }>('post', '/customers', {
        ...body,
        mobilePhone: undefined,
      });
      return { id: data.id };
    }
  }

  async createCharge(input: GatewayChargeInput): Promise<GatewayPayment> {
    const data = await this.request<AsaasPayment>('post', '/payments', {
      customer: input.customerId,
      billingType: input.billingType,
      value: input.value,
      dueDate: input.dueDate,
      description: input.description,
      externalReference: input.externalReference,
    });
    return mapAsaasPayment(data);
  }

  async getCharge(chargeId: string): Promise<GatewayPayment> {
    const data = await this.request<AsaasPayment>(
      'get',
      `/payments/${encodeURIComponent(chargeId)}`,
    );
    return mapAsaasPayment(data);
  }

  async cancelCharge(chargeId: string) {
    try {
      await this.request('delete', `/payments/${encodeURIComponent(chargeId)}`);
    } catch (error) {
      // Já removida no Asaas: o efeito desejado (cobrança inativa) já existe.
      if ((error as { gatewayStatus?: number }).gatewayStatus === 404) return;
      throw error;
    }
  }

  async getPixQrCode(chargeId: string): Promise<GatewayPixQrCode> {
    const data = await this.request<{
      payload: string;
      encodedImage?: string;
      expirationDate?: string;
    }>('get', `/payments/${encodeURIComponent(chargeId)}/pixQrCode`);
    return {
      payload: data.payload,
      encodedImage: data.encodedImage ?? null,
      expirationDate: data.expirationDate ?? null,
    };
  }

  isValidWebhookToken(token: string | undefined) {
    if (!this.webhookToken || !token) return false;
    const expected = Buffer.from(this.webhookToken);
    const received = Buffer.from(token);
    return (
      expected.length === received.length && timingSafeEqual(expected, received)
    );
  }

  parseWebhook(payload: unknown): GatewayWebhookEvent {
    return parseAsaasWebhook(payload);
  }

  private async request<T = unknown>(
    method: 'get' | 'post' | 'delete',
    url: string,
    body?: unknown,
  ): Promise<T> {
    if (!this.apiKey) {
      throw new ServiceUnavailableException(
        'Gateway de pagamento não configurado.',
      );
    }

    try {
      const response = await this.http.request({
        method,
        url,
        data: body,
        headers: { access_token: this.apiKey },
      });
      return response.data as T;
    } catch (error) {
      const axiosError = error as {
        message: string;
        response?: {
          status?: number;
          data?: { errors?: { code?: string; description?: string }[] };
        };
      };
      const status = axiosError.response?.status;
      const [gatewayError] = axiosError.response?.data?.errors ?? [];
      const description = gatewayError?.description;
      this.logger.error(
        `Asaas ${method.toUpperCase()} ${url} falhou (${status ?? 'sem resposta'}): ${description ?? axiosError.message}`,
      );
      const exception = new BadGatewayException(
        description ?? 'Falha ao comunicar com o gateway de pagamento.',
      );
      Object.assign(exception, {
        gatewayStatus: status,
        gatewayCode: gatewayError?.code,
      });
      throw exception;
    }
  }
}
