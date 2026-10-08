/** Who is replying: the salon the JWT says, and the staff member. */
export interface SalonInput {
  tenantId: string;
  branchId: string;
  actorId: string;
  reviewId: string;
}

export class PostReplyCommand {
  constructor(public readonly input: SalonInput & { body: unknown }) {}
}

export class EditReplyCommand {
  constructor(public readonly input: SalonInput & { body: unknown }) {}
}

export class DeleteReplyCommand {
  constructor(public readonly input: SalonInput) {}
}
