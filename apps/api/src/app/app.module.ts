import { MiddlewareConsumer, Module, RequestMethod } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from '../common/prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';
import { PriceListsModule } from '../price-lists/price-lists.module';
import { ProductsModule } from '../products/products.module';
import { QuotationsModule } from '../quotations/quotations.module';
import { SalesModule } from '../sales/sales.module';
import { StockModule } from '../stock/stock.module';
import { ReportsModule } from '../reports/reports.module';
import { SettingsModule } from '../settings/settings.module';
import { DisplayModule } from '../display/display.module';
import { IpWhitelistMiddleware } from '../common/middleware/ip-whitelist.middleware';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 5 }]),
    ScheduleModule.forRoot(),
    PrismaModule,
    AuthModule,
    UsersModule,
    PriceListsModule,
    ProductsModule,
    QuotationsModule,
    SalesModule,
    StockModule,
    ReportsModule,
    SettingsModule,
    DisplayModule,
  ],
})
export class AppModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(IpWhitelistMiddleware)
      .exclude(
        '/auth/login',
        '/auth/refresh',
        '/health',
        { path: 'display/(.*)', method: RequestMethod.GET },
      )
      .forRoutes({ path: '*', method: RequestMethod.ALL });
  }
}
