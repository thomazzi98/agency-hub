-- CreateTable
CREATE TABLE "branding_settings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "app_name" VARCHAR(60) NOT NULL,
    "primary_color" CHAR(7) NOT NULL,
    "secondary_color" CHAR(7) NOT NULL,
    "logo_url" TEXT,
    "favicon_url" TEXT,
    "login_image_url" TEXT,
    "login_message" VARCHAR(280),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "branding_settings_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "branding_settings" ADD CONSTRAINT "branding_settings_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- One brand, enforced by the database. A unique index on a constant expression
-- permits exactly one row; a convention only application code respects would be one
-- careless insert away from two.
CREATE UNIQUE INDEX "branding_settings_singleton" ON "branding_settings" ((true));

-- Seeded so the login screen, which reads this before any authentication, always
-- has something to render.
INSERT INTO "branding_settings" ("app_name", "primary_color", "secondary_color")
VALUES ('Agency Hub', '#1d4ed8', '#0f172a');
