-- CreateTable
CREATE TABLE "ReferenceDocument" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "edition" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "sourceSha256" TEXT NOT NULL,
    "rightsStatus" TEXT NOT NULL,
    "unitCount" INTEGER NOT NULL,
    "report" JSONB NOT NULL,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReferenceDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReferenceText" (
    "documentId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "context" TEXT,
    "sourceUrl" TEXT,

    CONSTRAINT "ReferenceText_pkey" PRIMARY KEY ("documentId","number")
);

-- AddForeignKey
ALTER TABLE "ReferenceText" ADD CONSTRAINT "ReferenceText_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "ReferenceDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;
