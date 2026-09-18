import { ApiProperty } from '@nestjs/swagger';
import { ItemResponseDto } from './item-response.dto';

/**
 * One page of items. Cursor-based rather than offset-based (.cursorrules §6):
 * a marker into the ordering stays correct while items are being added and
 * removed, where an offset silently skips or repeats rows.
 */
export class ItemPageDto {
  @ApiProperty({ type: [ItemResponseDto] })
  data!: ItemResponseDto[];

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Pass as `cursor` to fetch the next page. Null on the last page.',
  })
  nextCursor!: string | null;

  @ApiProperty({ description: 'Whether another page follows this one.' })
  hasMore!: boolean;
}
