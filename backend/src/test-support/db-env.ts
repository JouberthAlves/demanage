// Importar PRIMEIRO em testes unitários que carregam módulos com `@/lib/prisma`:
// o client só abre conexão sob demanda, mas exige DATABASE_URL na criação.
process.env.DATABASE_URL ??= 'postgresql://test:test@127.0.0.1:1/test';
