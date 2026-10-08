import { DomainError } from '../domain.error';
import { checkReplySubmission } from '../services/review-reply-rules';

/**
 * The salon's one answer to a review. Not a thread: the salon gets the last
 * word once. Withdrawing it is a HARD delete (the review aggregate drops it),
 * because the salon's own words on its own page are not moderation.
 */
export class Reply {
  private constructor(
    readonly id: string,
    private _body: string,
    readonly authorId: string,
    private _editedById: string | null,
    private _editedAt: Date | null,
    readonly createdAt: Date,
  ) {}

  /** Validated by the ported rules: required, trimmed, at most REPLY_MAX. */
  static write(p: { id: string; body: unknown; authorId: string; now: Date }): Reply {
    return new Reply(p.id, Reply.validBody(p.body), p.authorId, null, null, p.now);
  }

  static restore(p: {
    id: string;
    body: string;
    authorId: string;
    editedById: string | null;
    editedAt: Date | null;
    createdAt: Date;
  }): Reply {
    return new Reply(p.id, p.body, p.authorId, p.editedById, p.editedAt, p.createdAt);
  }

  /** A full replacement. An empty body is refused: deleting is its own act. */
  edit(body: unknown, editorId: string, now: Date): void {
    this._body = Reply.validBody(body);
    this._editedById = editorId;
    this._editedAt = now;
  }

  private static validBody(body: unknown): string {
    const { errors, normalized } = checkReplySubmission({ body });
    if (errors.length > 0) throw DomainError.validation(errors);
    return normalized.body;
  }

  get body() {
    return this._body;
  }
  get editedById() {
    return this._editedById;
  }
  get editedAt() {
    return this._editedAt;
  }
}
