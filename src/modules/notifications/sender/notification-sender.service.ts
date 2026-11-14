import { Injectable, Logger } from '@nestjs/common';
import { Resend } from 'resend';

@Injectable()
export class NotificationSenderService {
  private readonly logger = new Logger(NotificationSenderService.name);
  // Sem chave a API sobe igual; só o envio de e-mail fica indisponível.
  private readonly resend = process.env.RESEND_API_KEY
    ? new Resend(process.env.RESEND_API_KEY)
    : null;
  private readonly evolutionUrl = process.env.EVOLUTION_API_URL;
  private readonly evolutionKey = process.env.EVOLUTION_API_KEY;
  private readonly evolutionInstance = process.env.EVOLUTION_INSTANCE;

  async sendWhatsApp(phone: string, message: string): Promise<void> {
    try {
      const normalizedPhone = phone.replace(/\D/g, '');
      const recipient = normalizedPhone.startsWith('55')
        ? normalizedPhone
        : `55${normalizedPhone}`;
      const response = await fetch(
        `${this.evolutionUrl}/message/sendText/${this.evolutionInstance}`,
        {
          method: 'POST',
          headers: {
            'apikey': this.evolutionKey,
          'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            number: recipient,
            text: message,
          }),
        },
      );

      if (!response.ok) throw new Error(await response.text());

      this.logger.log(`✅ WhatsApp enviado para ${phone}`);
    } catch (err) {
      this.logger.error('❌ Erro ao enviar WhatsApp: ', err);
      throw err;
    }
  }

  async sendEmail(email: string, subject: string, html: string, text: string): Promise<void> {
    if (!this.resend) {
      this.logger.warn('RESEND_API_KEY ausente: e-mail não enviado');
      return;
    }
    const { error } = await this.resend.emails.send({
      from: 'Notificações <onboarding@resend.dev>',
      to: email,
      subject,
      html,
      text,
    });

    if (error) {
      this.logger.error('❌ Erro ao enviar email: ', error);
      throw new Error(error.message);
    }

    this.logger.log('✅ Email enviado com sucesso!');
  }
}
