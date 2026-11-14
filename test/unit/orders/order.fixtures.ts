import { OrderItemType, OrderStatus } from '@prisma/client';

// Comanda no formato devolvido pelo Prisma com ORDER_INCLUDE.
export const orderRow = (overrides: Record<string, any> = {}) => ({
  id: 'o1',
  number: 7,
  clientId: 'c1',
  appointmentId: null,
  status: OrderStatus.OPEN,
  subtotal: 0,
  discount: 0,
  total: 0,
  notes: null,
  openedById: 'u1',
  closedAt: null,
  paidAt: null,
  cancelledAt: null,
  cancelReason: null,
  createdAt: new Date('2026-11-13T12:00:00Z'),
  updatedAt: new Date('2026-11-13T12:00:00Z'),
  client: {
    id: 'c1',
    cpfCnpj: null,
    user: { id: 'cu1', name: 'Maria', phone: '79999990000', email: 'maria@ex.com' },
  },
  appointment: null,
  openedBy: { id: 'u1', name: 'Dona' },
  items: [],
  payments: [],
  ...overrides,
});

export const productItem = (overrides: Record<string, any> = {}) => ({
  id: 'i-prod',
  orderId: 'o1',
  type: OrderItemType.PRODUCT,
  serviceId: null,
  productId: 'p1',
  professionalId: null,
  description: 'Creme',
  quantity: 3,
  unitPrice: 20,
  total: 60,
  createdAt: new Date(),
  ...overrides,
});

export const serviceItem = (overrides: Record<string, any> = {}) => ({
  id: 'i-serv',
  orderId: 'o1',
  type: OrderItemType.SERVICE,
  serviceId: 's1',
  productId: null,
  professionalId: 'pro1',
  description: 'Corte de cachos',
  quantity: 1,
  unitPrice: 150,
  total: 150,
  createdAt: new Date(),
  ...overrides,
});
