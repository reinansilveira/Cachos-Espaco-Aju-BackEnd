import { BadRequestException } from '@nestjs/common';
import { INTERCEPTORS_METADATA } from '@nestjs/common/constants';
import { ExecutionContextHost } from '@nestjs/core/helpers/execution-context-host';
import { RmqContext } from '@nestjs/microservices';
import { Prisma } from '@prisma/client';
import { from, lastValueFrom, throwError } from 'rxjs';
import { NotificationConsumer } from '../../../src/queues/consumers/notification.consumer';
import { RmqAckInterceptor } from '../../../src/queues/interceptors/rmq-ack.interceptor';
import {
  AppointmentCreatedEvent,
  AppointmentReminderEvent,
} from '../../../src/queues/interfaces/events.interface';

describe('NotificationConsumer', () => {
  const notificationsService = {
    create: jest.fn(),
    claimPendingDelivery: jest.fn(),
    updateStatus: jest.fn(),
  };
  const sender = {
    sendEmail: jest.fn(),
    sendWhatsApp: jest.fn(),
  };
  const clientAccountService = {
    getNotificationPreferences: jest.fn(),
  };

  let consumer: NotificationConsumer;

  const createdEvent = (
    overrides: Partial<AppointmentCreatedEvent> = {},
  ): AppointmentCreatedEvent => ({
    appointmentId: 'appointment-1',
    clientId: 'client-1',
    clientUserId: 'user-client-1',
    clientName: 'Maria',
    clientPhone: '79999999999',
    clientEmail: 'maria@email.com',
    professionalId: 'professional-1',
    professionalUserId: 'user-professional-1',
    professionalName: 'Reinan',
    professionalPhone: '',
    professionalEmail: '',
    serviceName: 'Corte',
    scheduledAt: new Date('2026-11-02T10:00:00.000Z'),
    duration: 30,
    price: 50,
    ...overrides,
  });

  const reminderEvent = (
    overrides: Partial<AppointmentReminderEvent> = {},
  ): AppointmentReminderEvent => ({
    appointmentId: 'appointment-1',
    clientId: 'client-1',
    clientUserId: 'user-client-1',
    clientPhone: '79999999999',
    clientEmail: 'maria@email.com',
    serviceName: 'Corte',
    professionalName: 'Reinan',
    scheduledAt: new Date('2026-11-02T10:00:00.000Z'),
    ...overrides,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    consumer = new NotificationConsumer(
      notificationsService as any,
      sender as any,
      clientAccountService as any,
    );
  });

  it('não cria canais que o cliente desativou', async () => {
    clientAccountService.getNotificationPreferences.mockResolvedValue({
      emailEnabled: false,
      smsEnabled: true,
      whatsappEnabled: false,
      pushEnabled: true,
    });

    await consumer.handleCreated(createdEvent());

    expect(clientAccountService.getNotificationPreferences).toHaveBeenCalledWith(
      'client-1',
    );
    expect(sender.sendWhatsApp).not.toHaveBeenCalled();
    expect(sender.sendEmail).not.toHaveBeenCalled();
    expect(notificationsService.create).not.toHaveBeenCalled();
  });

  it('persiste dono e chaves idempotentes para os canais habilitados', async () => {
    clientAccountService.getNotificationPreferences.mockResolvedValue({
      emailEnabled: true,
      smsEnabled: true,
      whatsappEnabled: true,
      pushEnabled: true,
    });
    notificationsService.create
      .mockResolvedValueOnce({ id: 'notification-whatsapp', status: 'PENDING' })
      .mockResolvedValueOnce({ id: 'notification-email', status: 'PENDING' });
    notificationsService.claimPendingDelivery.mockResolvedValue(true);

    await consumer.handleReminder(reminderEvent());

    expect(notificationsService.create).toHaveBeenNthCalledWith(1, {
      appointmentId: 'appointment-1',
      recipientUserId: 'user-client-1',
      recipient: '79999999999',
      type: 'WHATSAPP',
      subject: expect.any(String),
      message: expect.any(String),
      idempotencyKey: 'appointments.reminder:appointment-1:client:WHATSAPP',
    });
    expect(notificationsService.create).toHaveBeenNthCalledWith(2, {
      appointmentId: 'appointment-1',
      recipientUserId: 'user-client-1',
      recipient: 'maria@email.com',
      type: 'EMAIL',
      subject: expect.any(String),
      message: expect.any(String),
      idempotencyKey: 'appointments.reminder:appointment-1:client:EMAIL',
    });
    expect(notificationsService.claimPendingDelivery).toHaveBeenNthCalledWith(
      1,
      'notification-whatsapp',
    );
    expect(notificationsService.claimPendingDelivery).toHaveBeenNthCalledWith(
      2,
      'notification-email',
    );
    expect(sender.sendWhatsApp).toHaveBeenCalledWith(
      '79999999999',
      expect.any(String),
    );
    expect(sender.sendEmail).toHaveBeenCalledWith(
      'maria@email.com',
      expect.any(String),
      expect.any(String),
      expect.any(String),
    );
    expect(notificationsService.updateStatus).toHaveBeenCalledWith(
      'notification-whatsapp',
      { status: 'SENT' },
    );
    expect(notificationsService.updateStatus).toHaveBeenCalledWith(
      'notification-email',
      { status: 'SENT' },
    );
  });

  it('não reenfileira um envio que a chave idempotente já marcou como enviado', async () => {
    clientAccountService.getNotificationPreferences.mockResolvedValue({
      emailEnabled: true,
      smsEnabled: true,
      whatsappEnabled: true,
      pushEnabled: true,
    });
    notificationsService.create
      .mockResolvedValueOnce({ id: 'notification-whatsapp', status: 'SENT' })
      .mockResolvedValueOnce({ id: 'notification-email', status: 'SENT' });

    await consumer.handleReminder(reminderEvent());

    expect(notificationsService.claimPendingDelivery).not.toHaveBeenCalled();
    expect(sender.sendWhatsApp).not.toHaveBeenCalled();
    expect(sender.sendEmail).not.toHaveBeenCalled();
    expect(notificationsService.updateStatus).not.toHaveBeenCalled();
  });

  it('registra FAILED quando o provedor rejeita uma entrega já reivindicada', async () => {
    clientAccountService.getNotificationPreferences.mockResolvedValue({
      emailEnabled: true,
      smsEnabled: true,
      whatsappEnabled: false,
      pushEnabled: true,
    });
    notificationsService.create.mockResolvedValue({
      id: 'notification-email',
      status: 'PENDING',
    });
    notificationsService.claimPendingDelivery.mockResolvedValue(true);
    sender.sendEmail.mockRejectedValue(new Error('Falha do provedor'));

    await consumer.handleReminder(reminderEvent({ clientPhone: '' }));

    expect(notificationsService.updateStatus).toHaveBeenCalledWith(
      'notification-email',
      { status: 'FAILED' },
    );
  });

  it('propaga uma falha de persistência para o broker redeliver o evento', async () => {
    clientAccountService.getNotificationPreferences.mockResolvedValue({
      emailEnabled: true,
      smsEnabled: true,
      whatsappEnabled: false,
      pushEnabled: true,
    });
    notificationsService.create.mockRejectedValue(new Error('Banco indisponível'));

    await expect(
      consumer.handleReminder(reminderEvent({ clientPhone: '' })),
    ).rejects.toThrow('Banco indisponível');

    expect(sender.sendEmail).not.toHaveBeenCalled();
  });

  it('envia a mensagem legível ao profissional e vincula ao usuário profissional', async () => {
    clientAccountService.getNotificationPreferences.mockResolvedValue({
      emailEnabled: false,
      smsEnabled: true,
      whatsappEnabled: false,
      pushEnabled: true,
    });
    notificationsService.create.mockResolvedValue({
      id: 'notification-professional',
      status: 'PENDING',
    });
    notificationsService.claimPendingDelivery.mockResolvedValue(true);

    await consumer.handleCreated(
      createdEvent({
        clientPhone: '',
        clientEmail: '',
        professionalPhone: '79998887766',
      }),
    );

    expect(notificationsService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientUserId: 'user-professional-1',
        recipient: '79998887766',
        type: 'WHATSAPP',
        idempotencyKey: 'appointments.created:appointment-1:professional:WHATSAPP',
        message: expect.stringContaining('Novo agendamento recebido!'),
      }),
    );
    expect(sender.sendWhatsApp).toHaveBeenCalledWith(
      '79998887766',
      expect.stringContaining('Novo agendamento recebido!'),
    );
  });

  describe('confirmação no RabbitMQ', () => {
    const interceptor = new RmqAckInterceptor();
    const channel = { ack: jest.fn(), nack: jest.fn() };

    const rmqMessage = (redelivered = false) => ({
      content: Buffer.from('{}'),
      fields: { redelivered },
      properties: {},
    });

    const run = async (
      handler: () => Promise<unknown>,
      message = rmqMessage(),
    ) => {
      const rmq = new RmqContext([message, channel, 'appointments.reminder']);
      const context = new ExecutionContextHost([{}, rmq]);
      context.setType('rpc');

      await lastValueFrom(
        interceptor.intercept(context, {
          handle: () => from(handler()),
        }),
        { defaultValue: undefined },
      );

      return message;
    };

    it('está aplicado em todos os handlers do consumer', () => {
      expect(
        Reflect.getMetadata(INTERCEPTORS_METADATA, NotificationConsumer),
      ).toContain(RmqAckInterceptor);
    });

    it('confirma o evento quando o handler termina', async () => {
      clientAccountService.getNotificationPreferences.mockResolvedValue(null);
      notificationsService.create.mockResolvedValue({
        id: 'notification-email',
        status: 'SENT',
      });

      const message = await run(() =>
        consumer.handleReminder(reminderEvent({ clientPhone: '' })),
      );

      expect(channel.ack).toHaveBeenCalledWith(message);
      expect(channel.nack).not.toHaveBeenCalled();
    });

    it('confirma também quando o provedor falha, pois o FAILED já foi registrado', async () => {
      clientAccountService.getNotificationPreferences.mockResolvedValue(null);
      notificationsService.create.mockResolvedValue({
        id: 'notification-email',
        status: 'PENDING',
      });
      notificationsService.claimPendingDelivery.mockResolvedValue(true);
      sender.sendEmail.mockRejectedValue(new Error('Falha do provedor'));

      const message = await run(() =>
        consumer.handleReminder(reminderEvent({ clientPhone: '' })),
      );

      expect(channel.ack).toHaveBeenCalledWith(message);
    });

    it('descarta sem requeue o evento de um agendamento que não existe mais', async () => {
      clientAccountService.getNotificationPreferences.mockResolvedValue(null);
      notificationsService.create.mockRejectedValue(
        new BadRequestException('Appointment não encontrado'),
      );

      const message = await run(() =>
        consumer.handleReminder(reminderEvent({ clientPhone: '' })),
      );

      expect(channel.nack).toHaveBeenCalledWith(message, false, false);
      expect(channel.ack).not.toHaveBeenCalled();
      expect(sender.sendEmail).not.toHaveBeenCalled();
    });

    it('descarta sem requeue erro de chave estrangeira do Prisma', async () => {
      const error = new Prisma.PrismaClientKnownRequestError('fk', {
        code: 'P2003',
        clientVersion: 'test',
      });

      const message = await run(() => Promise.reject(error));

      expect(channel.nack).toHaveBeenCalledWith(message, false, false);
    });

    it('devolve à fila uma vez um erro transitório', async () => {
      clientAccountService.getNotificationPreferences.mockResolvedValue(null);
      notificationsService.create.mockRejectedValue(new Error('Banco indisponível'));

      const message = await run(() =>
        consumer.handleReminder(reminderEvent({ clientPhone: '' })),
      );

      expect(channel.nack).toHaveBeenCalledWith(message, false, true);
      expect(channel.ack).not.toHaveBeenCalled();
    });

    it('descarta o erro transitório que já é uma reentrega, para não travar a fila', async () => {
      const message = await run(
        () => Promise.reject(new Error('Banco indisponível')),
        rmqMessage(true),
      );

      expect(channel.nack).toHaveBeenCalledWith(message, false, false);
    });

    it('não derruba o consumer quando o canal já foi fechado', async () => {
      channel.ack.mockImplementationOnce(() => {
        throw new Error('Channel closed');
      });

      await expect(run(() => Promise.resolve())).resolves.toBeDefined();
    });

    it('ignora contextos que não são RPC', async () => {
      const context = new ExecutionContextHost([{}, {}]);
      context.setType('http');

      await expect(
        lastValueFrom(
          interceptor.intercept(context, {
            handle: () => throwError(() => new Error('http')),
          }),
        ),
      ).rejects.toThrow('http');
      expect(channel.ack).not.toHaveBeenCalled();
      expect(channel.nack).not.toHaveBeenCalled();
    });
  });
});
