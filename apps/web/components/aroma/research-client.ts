"use client";

import { createResearchClient } from "@/lib/sdk";
import { aromaClient } from "./api-client";

export const researchClient = createResearchClient((mint, signal) => aromaClient.getResearch(mint, signal));
