import { currentUser } from "@clerk/nextjs";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/db";
import { GuestbookHashids } from "@/db/dto/guestbook.dto";
import { guestbook } from "@/db/schema";
import { ratelimit } from "@/lib/redis";

type RouteSegment = { params: { id: string } };

function getKey(id?: string) {
  return `guestbook${id ? `:${id}` : ""}`;
}
const EditGuestbookSchema = z.object({
  message: z.string().min(1).max(50000),
  tags: z.array(z.string()).nullable().optional(),
  isUseMarkdown: z.boolean().optional(),
});

export async function POST(req: Request, { params }: RouteSegment) {
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const { success } = await ratelimit.limit(getKey(user.id));
  if (!success) {
    return new Response("Too Many Requests", {
      status: 429,
    });
  }
  try {
    const { id } = z.object({ id: z.string() }).parse(params);
    const data = await req.json();

    const { message, tags, isUseMarkdown } = EditGuestbookSchema.parse(data);

    const decodedIds = GuestbookHashids.decode(id);
    const decodedId = decodedIds[0];
    if (!decodedId || typeof decodedId !== "number") {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }
    const userIdInGuestbookWillBeEdit = await db
      .select()
      .from(guestbook)
      .where(eq(guestbook.id, decodedId));
    const isOwner =
      userIdInGuestbookWillBeEdit &&
      userIdInGuestbookWillBeEdit[0]?.userId === user.id;
    const isSiteOwner = user.publicMetadata.siteOwner;
    if (isOwner || isSiteOwner) {
      const result = await db
        .update(guestbook)
        .set({ message: message, tags: tags, isUseMarkdown: isUseMarkdown })
        .where(eq(guestbook.id, decodedId));
      return NextResponse.json(result);
    } else {
      return NextResponse.json({ error: "No permission" }, { status: 403 });
    }
  } catch (error) {
    return NextResponse.json({ error }, { status: 400 });
  }
}
