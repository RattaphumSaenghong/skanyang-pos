import { MiddlewareConsumer, Module, RequestMethod } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
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
import { BaysModule } from '../bays/bays.module';
import { ServiceCatalogModule } from '../service-catalog/service-catalog.module';
import { BillMatcherModule } from '../bill-matcher/bill-matcher.module';
import { IpWhitelistMiddleware } from '../common/middleware/ip-whitelist.middleware';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    // Generous global default: a whole shop shares one public IP, and each
    // customer display polls every 3s (20 req/min per screen). Tight enough to
    // stop scraping, loose enough not to lock out a busy shop. Login overrides
    // this with a much stricter limit.
    ThrottlerModule.forRoot({
      throttlers: [{ name: 'default', ttl: 60000, limit: 600 }],
      // The API runs behind a proxy and `trust proxy` is not set, so req.ip is
      // the proxy's. Derive the real client the same way auth.controller does,
      // otherwise every request counts against a single shared bucket.
      getTracker: (req: Record<string, any>) => {
        const fwd = req.headers?.['x-forwarded-for'];
        const first = Array.isArray(fwd) ? fwd[0] : typeof fwd === 'string' ? fwd.split(',')[0] : null;
        return (first?.trim() || req.ip) as string;
      },
    }),
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
    BaysModule,
    ServiceCatalogModule,
    BillMatcherModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
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
