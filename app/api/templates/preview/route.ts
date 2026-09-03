import { NextRequest, NextResponse } from "next/server";

import { compileEmailContent } from "@/lib/mjml";
import { renderVariables, SAMPLE_VARIABLES } from "@/lib/render";
import { errorMessage } from "@/lib/utils";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const mjml = typeof body.mjml === "string" ? body.mjml : "";
    if (!mjml.trim()) {
      return NextResponse.json(
        { error: "Envie o código MJML para gerar o preview." },
        { status: 400 }
      );
    }

    const variables = {
      ...SAMPLE_VARIABLES,
      ...(body.variables && typeof body.variables === "object"
        ? body.variables
        : {}),
    };

    const rendered = renderVariables(mjml, variables);
    const { html, errors } = await compileEmailContent(rendered);

    return NextResponse.json({ html, errors });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
