// Configuration Prisma 7 : le banc n'utilise que `prisma generate`, qui n'a pas
// besoin de connexion ; le client se connecte par l'adaptateur MariaDB (bench.mjs).
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
});
