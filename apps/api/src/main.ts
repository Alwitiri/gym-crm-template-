import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import { AppModule } from "./app.module";
import { config } from "./core/config";
import { requestContext } from "./core/request-context";

// BigInt (audit ids, sequence values) → JSON number.
(BigInt.prototype as any).toJSON = function () {
  return Number(this);
};

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true, logger: ["error", "warn", "log"] });
  app.set("trust proxy", 1); // behind one load balancer / the Next.js proxy
  app.disable("x-powered-by");
  app.use(requestContext);
  app.use(helmet());
  app.use(cookieParser());
  app.useBodyParser("json", { limit: "200kb" });
  app.enableCors({ origin: [config.webOrigin], credentials: true });
  app.setGlobalPrefix("api/v1");
  app.enableShutdownHooks();
  await app.listen(config.port);
  console.log(`API listening on :${config.port}`);
}

void bootstrap();
