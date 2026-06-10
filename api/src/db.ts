/**
 * Conexao com o banco PostGIS. Usa um "pool" (varias conexoes reaproveitadas),
 * porque a API atende muitos pedidos ao mesmo tempo. As credenciais vem do
 * mesmo arquivo do banco e do ETL: infra/.env.
 */
import * as path from "node:path";
import * as dotenv from "dotenv";
import { Pool } from "pg";

dotenv.config({ path: path.resolve(__dirname, "..", "..", "infra", ".env") });

export const pool = new Pool({
  host: process.env.PGHOST || "localhost",
  port: Number(process.env.POSTGRES_PORT) || 5432,
  user: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD,
  database: process.env.POSTGRES_DB,
  max: 10,
});
