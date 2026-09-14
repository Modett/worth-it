import { ApiProperty } from '@nestjs/swagger';

export class SessionResponseDto {
  @ApiProperty({ format: 'uuid', description: 'Id of the user the access token belongs to' })
  userId!: string;
}
