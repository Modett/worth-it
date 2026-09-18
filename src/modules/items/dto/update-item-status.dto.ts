import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import { ITEMS_CONFIG, RequestedItemStatus } from '../items.config';

/**
 * The only way an item's status changes. Which of these is actually reachable
 * depends on where the item is now — see `ITEMS_CONFIG.statusTransitions`.
 */
export class UpdateItemStatusDto {
  @ApiProperty({
    enum: [...ITEMS_CONFIG.requestableStatuses],
    example: ITEMS_CONFIG.requestableStatuses[0],
    description:
      'PAUSED is absent by design: an item enters a cooling-off pause through the pauses ' +
      'module, not by a client asking for the status directly.',
  })
  @IsIn([...ITEMS_CONFIG.requestableStatuses])
  status!: RequestedItemStatus;
}
