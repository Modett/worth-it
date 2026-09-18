import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

/**
 * The only scoring input that is not already on the item or the user. V1 has
 * no closet scan, so "do you already own something similar?" is self-reported
 * and sent by the client rather than inferred here.
 */
export class ComputeScoreDto {
  @ApiProperty({
    example: false,
    description:
      'Whether the user already owns something similar. Self-reported in V1; the server does not infer it.',
  })
  @IsBoolean()
  similarOwned!: boolean;
}
