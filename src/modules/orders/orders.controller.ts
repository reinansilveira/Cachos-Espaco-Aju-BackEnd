import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { AdminOrProfessionalAuthGuard } from '../auth/guards/admin-or-professional-auth.guard';
import { AuthPrincipal } from '../auth/types/auth-principal.type';
import { AddOrderItemDto, UpdateOrderItemDto } from './dto/add-order-item.dto';
import { CreateOrderPaymentDto } from './dto/create-order-payment.dto';
import { CreateOrderDto } from './dto/create-order.dto';
import { ListOrdersQuery } from './dto/list-orders.query';
import { CancelOrderDto, UpdateOrderDto } from './dto/update-order.dto';
import { OrderPaymentsService } from './order-payments.service';
import { OrdersService } from './orders.service';

const userId = (request: Request) => (request['user'] as AuthPrincipal).sub;

@ApiTags('Orders')
@ApiBearerAuth()
@UseGuards(AdminOrProfessionalAuthGuard)
@Controller('orders')
export class OrdersController {
  constructor(
    private readonly orders: OrdersService,
    private readonly payments: OrderPaymentsService,
  ) {}

  @Get()
  findAll(@Query() query: ListOrdersQuery) {
    return this.orders.findAll(query);
  }

  @Get('summary')
  summary(@Query('from') from?: string, @Query('to') to?: string) {
    return this.orders.summary(from, to);
  }

  @Get('clients')
  searchClients(@Query('search') search?: string) {
    return this.orders.searchClients(search);
  }

  @Get(':id')
  findById(@Param('id', ParseUUIDPipe) id: string) {
    return this.orders.findById(id);
  }

  @Post()
  create(@Body() dto: CreateOrderDto, @Req() request: Request) {
    return this.orders.create(dto, userId(request));
  }

  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateOrderDto) {
    return this.orders.update(id, dto);
  }

  @Post(':id/items')
  addItem(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AddOrderItemDto) {
    return this.orders.addItem(id, dto);
  }

  @Patch(':id/items/:itemId')
  updateItem(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body() dto: UpdateOrderItemDto,
  ) {
    return this.orders.updateItem(id, itemId, dto);
  }

  @Delete(':id/items/:itemId')
  removeItem(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
  ) {
    return this.orders.removeItem(id, itemId);
  }

  @Post(':id/close')
  close(@Param('id', ParseUUIDPipe) id: string, @Req() request: Request) {
    return this.orders.close(id, userId(request));
  }

  @Post(':id/reopen')
  reopen(@Param('id', ParseUUIDPipe) id: string, @Req() request: Request) {
    return this.orders.reopen(id, userId(request));
  }

  @Post(':id/cancel')
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelOrderDto,
    @Req() request: Request,
  ) {
    return this.orders.cancel(id, dto.reason, userId(request));
  }

  @Post(':id/payments')
  createPayment(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateOrderPaymentDto,
    @Req() request: Request,
  ) {
    return this.payments.create(id, dto, userId(request));
  }

  @Get(':id/payments/:paymentId/pix')
  pix(@Param('paymentId', ParseUUIDPipe) paymentId: string) {
    return this.payments.getPix(paymentId);
  }

  @Post(':id/payments/:paymentId/refresh')
  refresh(@Param('paymentId', ParseUUIDPipe) paymentId: string) {
    return this.payments.refresh(paymentId);
  }

  @Post(':id/payments/:paymentId/cancel')
  cancelPayment(@Param('paymentId', ParseUUIDPipe) paymentId: string) {
    return this.payments.cancel(paymentId);
  }
}
