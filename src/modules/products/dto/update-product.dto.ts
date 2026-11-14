import { OmitType, PartialType } from '@nestjs/swagger';
import { CreateProductDto } from './create-product.dto';

// O saldo só muda por movimento de estoque, nunca pela edição do produto.
export class UpdateProductDto extends PartialType(
  OmitType(CreateProductDto, ['initialStock'] as const),
) {}
