-- Sinal do agendamento online entra como pagamento da comanda.
ALTER TABLE "order_payments" ADD COLUMN "isDeposit" BOOLEAN NOT NULL DEFAULT false;

-- Com o sinal, uma comanda pode ter mais de um pagamento pago (sinal + saldo).
-- Continua valendo só uma cobrança pendente por vez.
DROP INDEX "order_payments_one_active_per_order";
CREATE UNIQUE INDEX "order_payments_one_pending_per_order"
  ON "order_payments" ("orderId") WHERE "status" = 'PENDING';
