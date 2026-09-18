import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ItemStatus } from '../../../generated/prisma/client';
import { SCORING_CONFIG } from '../scoring.config';

/**
 * Domain exceptions for the scoring module (.cursorrules §3). They extend Nest's
 * HttpExceptions so AllExceptionsFilter renders them in the standard error
 * shape, and no Prisma detail ever reaches the client.
 */

export class ScoreNotFoundException extends NotFoundException {
  constructor() {
    // Distinct from `Item not found`: the item exists and belongs to the
    // caller, it just has never been through POST /items/:id/score. Same 404
    // status so a missing score cannot be confused with an auth failure.
    super('No regret score has been computed for this item');
  }
}

export class ItemNotScorableException extends BadRequestException {
  constructor(currentStatus: ItemStatus) {
    super(
      `A regret score can only be computed while the item is ${SCORING_CONFIG.scorableStatuses.join(' or ')}; ` +
        `this item is ${currentStatus}`,
    );
  }
}
