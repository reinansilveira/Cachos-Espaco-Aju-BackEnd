import { Prisma } from '@prisma/client';
import { balanceDue, paidAmount } from '../rules/payment-balance';

export const ORDER_INCLUDE = {
  client: {
    select: {
      id: true,
      cpfCnpj: true,
      user: { select: { id: true, name: true, phone: true, email: true } },
    },
  },
  appointment: {
    select: {
      id: true,
      scheduledAt: true,
      status: true,
      service: { select: { id: true, name: true } },
    },
  },
  openedBy: { select: { id: true, name: true } },
  items: {
    orderBy: { createdAt: 'asc' },
    include: {
      professional: { select: { id: true, user: { select: { name: true } } } },
      product: { select: { id: true, unit: true, stockQuantity: true } },
    },
  },
  payments: { orderBy: { createdAt: 'desc' } },
} satisfies Prisma.OrderInclude;

export type OrderWithRelations = Prisma.OrderGetPayload<{
  include: typeof ORDER_INCLUDE;
}>;

type PaymentRow = OrderWithRelations['payments'][number];

export function mapOrderPayment(payment: PaymentRow) {
  return {
    id: payment.id,
    method: payment.method,
    gateway: payment.gateway,
    isDeposit: payment.isDeposit,
    status: payment.status,
    amount: Number(payment.amount),
    invoiceUrl: payment.invoiceUrl,
    pixPayload: payment.pixPayload,
    dueDate: payment.dueDate,
    paidAt: payment.paidAt,
    refundedAt: payment.refundedAt,
    notes: payment.notes,
    createdAt: payment.createdAt,
  };
}

export function mapOrder(order: OrderWithRelations) {
  return {
    id: order.id,
    number: order.number,
    status: order.status,
    subtotal: Number(order.subtotal),
    discount: Number(order.discount),
    total: Number(order.total),
    paidAmount: paidAmount(order.payments),
    dueAmount: balanceDue(order.total, order.payments),
    notes: order.notes,
    client: order.client
      ? {
          id: order.client.id,
          name: order.client.user.name,
          phone: order.client.user.phone,
          email: order.client.user.email,
          hasCpf: !!order.client.cpfCnpj,
        }
      : null,
    appointment: order.appointment
      ? {
          id: order.appointment.id,
          scheduledAt: order.appointment.scheduledAt,
          status: order.appointment.status,
          serviceName: order.appointment.service.name,
        }
      : null,
    openedBy: order.openedBy,
    items: order.items.map((item) => ({
      id: item.id,
      type: item.type,
      serviceId: item.serviceId,
      productId: item.productId,
      description: item.description,
      quantity: item.quantity,
      unitPrice: Number(item.unitPrice),
      total: Number(item.total),
      professional: item.professional
        ? { id: item.professional.id, name: item.professional.user.name }
        : null,
      availableStock: item.product?.stockQuantity ?? null,
    })),
    payments: order.payments.map(mapOrderPayment),
    closedAt: order.closedAt,
    paidAt: order.paidAt,
    cancelledAt: order.cancelledAt,
    cancelReason: order.cancelReason,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
  };
}

