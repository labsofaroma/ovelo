CREATE TABLE "purchase_channels" (
	"signature" text NOT NULL,
	"channel" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_channels_signature_pk" PRIMARY KEY("signature"),
	CONSTRAINT "purchase_channels_channel_valid" CHECK ("purchase_channels"."channel" IN ('action'))
);
