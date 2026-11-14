import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
  DefaultValuePipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { AdminAuthGuard } from '../auth/guards/admin-auth.guard';
import { AdminOrProfessionalAuthGuard } from '../auth/guards/admin-or-professional-auth.guard';
import { AuthPrincipal } from '../auth/types/auth-principal.type';
import { CreateProductDto } from './dto/create-product.dto';
import { CreateStockMovementDto } from './dto/create-stock-movement.dto';
import { ListProductsQuery } from './dto/list-products.query';
import { UpdateProductDto } from './dto/update-product.dto';
import { ProductsService } from './products.service';

const userId = (request: Request) => (request['user'] as AuthPrincipal).sub;

@ApiTags('Products')
@ApiBearerAuth()
@UseGuards(AdminOrProfessionalAuthGuard)
@Controller('products')
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @Get()
  findAll(@Query() query: ListProductsQuery) {
    return this.products.findAll(query);
  }

  @Get('movements')
  listMovements(
    @Query('take', new DefaultValuePipe(50), ParseIntPipe) take: number,
  ) {
    return this.products.listMovements(undefined, take);
  }

  @Get(':id')
  findById(@Param('id', ParseUUIDPipe) id: string) {
    return this.products.findById(id);
  }

  @Post()
  create(@Body() dto: CreateProductDto, @Req() request: Request) {
    return this.products.create(dto, userId(request));
  }

  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateProductDto) {
    return this.products.update(id, dto);
  }

  @Delete(':id')
  @UseGuards(AdminAuthGuard)
  deactivate(@Param('id', ParseUUIDPipe) id: string) {
    return this.products.deactivate(id);
  }

  @Get(':id/movements')
  productMovements(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('take', new DefaultValuePipe(50), ParseIntPipe) take: number,
  ) {
    return this.products.listMovements(id, take);
  }

  @Post(':id/movements')
  registerMovement(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateStockMovementDto,
    @Req() request: Request,
  ) {
    return this.products.registerMovement(id, dto, userId(request));
  }
}
