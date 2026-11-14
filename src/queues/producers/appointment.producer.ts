import { Injectable, Logger } from '@nestjs/common';
import { Client, ClientProxy, Transport } from '@nestjs/microservices';
import { lastValueFrom } from 'rxjs';
import {
    AppointmentCancelledEvent,
    AppointmentCreatedEvent,
    AppointmentReminderEvent,
    ClientReengagementEvent,
} from '../interfaces/events.interface';

@Injectable()
export class AppointmentProducer {
    private readonly logger = new Logger(AppointmentProducer.name);

    @Client({
        transport: Transport.RMQ,
        options: {
            urls: [process.env.RABBITMQ_URL],
            queue: 'cachos_aju_queue',
            queueOptions: { durable: true },
        },
    })
    private client: ClientProxy;

    private async publish(pattern: string, event: unknown) {
        // Sem fila configurada, o agendamento segue e só os avisos deixam de sair.
        if (!process.env.RABBITMQ_URL) {
            this.logger.warn(`RABBITMQ_URL ausente: ${pattern} não publicado`);
            return;
        }
        await lastValueFrom(this.client.emit(pattern, event));
    }

    async publishCreated(event: AppointmentCreatedEvent) {
        await this.publish('appointments.created', event);
    }

    async publishConfirmed(event: AppointmentCreatedEvent) {
        await this.publish('appointments.confirmed', event);
    }

    async publishCancelled(event: AppointmentCancelledEvent) {
        await this.publish('appointments.cancelled', event);
    }

    async publishCompleted(event: AppointmentCreatedEvent) {
        await this.publish('appointments.completed', event);
    }

    async publishRescheduled(event: AppointmentCreatedEvent) {
        await this.publish('appointments.rescheduled', event);
    }

    async publishReminder(event: AppointmentReminderEvent) {
        await this.publish('appointments.reminder', event);
    }

    async publishReengagement(event: ClientReengagementEvent) {
        await this.publish('clients.reengagement', event);
    }
}
