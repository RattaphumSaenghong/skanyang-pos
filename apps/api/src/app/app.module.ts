import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../common/prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';
import { PriceListsModule } from '../price-lists/price-lists.module';
import { ProductsModule } from '../products/products.module';
import { QuotationsModule } from '../quotations/quotations.module';
import { SalesModule } from '../sales/sales.module';
import { StockModule } from '../stock/stock.module';
import { ReportsModule } from '../reports/reports.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuthModule,
    UsersModule,
    PriceListsModule,
    ProductsModule,
    QuotationsModule,
    SalesModule,
    StockModule,
    ReportsModule,
  ],
})
export class AppModule {}
