import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ItemStatus } from '../../../generated/prisma/client';
import { ITEMS_CONFIG } from '../items.config';

/**
 * Domain exceptions for the items module (.cursorrules §3). They extend Nest's
 * HttpExceptions so AllExceptionsFilter renders them in the standard error
 * shape, and no Prisma detail ever reaches the client.
 */

export class ItemNotFoundException extends NotFoundException {
  constructor() {
    // Raised both when no such item exists and when it belongs to someone
    // else. A 403 for the second case would confirm that the id is real, which
    // is exactly the existence check an attacker with a valid token wants.
    super('Item not found');
  }
}

/**
 * The three state violations below are 400s rather than 409s so that every
 * lifecycle rejection in this module reads the same way to a client: the
 * request described a change the item cannot make, and retrying it unchanged
 * will never succeed.
 */

export class ItemNotEditableException extends BadRequestException {
  constructor(currentStatus: ItemStatus) {
    super(
      `Item fields can only be edited while the item is ${ITEMS_CONFIG.editableStatuses.join(' or ')}; this item is ${currentStatus}`,
    );
  }
}

export class InvalidStatusTransitionException extends BadRequestException {
  constructor(currentStatus: ItemStatus, requestedStatus: ItemStatus) {
    const allowed = ITEMS_CONFIG.statusTransitions[currentStatus];
    super(
      `Cannot change status from ${currentStatus} to ${requestedStatus}` +
        (allowed.length === 0
          ? `; ${currentStatus} is a final status`
          : `; from ${currentStatus} the allowed statuses are ${allowed.join(', ')}`),
    );
  }
}

export class ItemNotDeletableException extends BadRequestException {
  constructor(currentStatus: ItemStatus) {
    super(
      `An item can only be deleted while it is ${ITEMS_CONFIG.deletableStatuses.join(' or ')}; ` +
        `this item is ${currentStatus} and is kept as purchase history`,
    );
  }
}

export class InvalidScreenshotException extends BadRequestException {
  constructor(message: string) {
    super(message);
  }
}
