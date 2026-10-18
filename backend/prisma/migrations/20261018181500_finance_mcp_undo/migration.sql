CREATE TABLE "FinanceMcpUndo" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "intentNonce" TEXT NOT NULL,
    "operationId" TEXT NOT NULL,
    "undoneAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FinanceMcpUndo_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FinanceMcpUndo_operationId_key" ON "FinanceMcpUndo"("operationId");
CREATE UNIQUE INDEX "FinanceMcpUndo_userId_clientId_intentNonce_key" ON "FinanceMcpUndo"("userId","clientId","intentNonce");
CREATE INDEX "FinanceMcpUndo_userId_clientId_undoneAt_idx" ON "FinanceMcpUndo"("userId","clientId","undoneAt");

ALTER TABLE "FinanceMcpUndo" ADD CONSTRAINT "FinanceMcpUndo_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FinanceMcpUndo" ADD CONSTRAINT "FinanceMcpUndo_operationId_fkey"
FOREIGN KEY ("operationId") REFERENCES "FinanceMcpOperation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
