import {
  IsArray,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
  ValidationArguments,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
  registerDecorator,
} from 'class-validator';
import { Type } from 'class-transformer';

@ValidatorConstraint({ name: 'isDivisibleBy4' })
class IsDivisibleBy4Constraint implements ValidatorConstraintInterface {
  validate(value: number) {
    return Number.isInteger(value) && value % 4 === 0;
  }
  defaultMessage(_args: ValidationArguments) {
    return 'qty must be a multiple of 4';
  }
}

function IsDivisibleBy4(options?: ValidationOptions) {
  return (object: object, propertyName: string) => {
    registerDecorator({
      target: object.constructor,
      propertyName,
      options,
      constraints: [],
      validator: IsDivisibleBy4Constraint,
    });
  };
}

export class CreateQuotationItemDto {
  @IsString()
  @IsNotEmpty()
  priceEntryId: string;

  @IsInt()
  @Min(4)
  @IsDivisibleBy4()
  qty: number;
}

export class CreateQuotationDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateQuotationItemDto)
  items: CreateQuotationItemDto[];

  @IsString()
  @IsOptional()
  customerId?: string;

  @IsString()
  @IsOptional()
  plateNumber?: string;

  @IsString()
  @IsOptional()
  notes?: string;
}
