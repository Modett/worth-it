import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

/** Body for both /auth/refresh and /auth/logout. */
export class RefreshTokenDto {
  @ApiProperty({
    description: 'The opaque refresh token returned by login or refresh',
    example: 'Yl8xQk1nR3ZkQ2pRb0pVRUhoZ0ZqZ1RxWl8tZ1ZQTkM',
  })
  @IsString()
  @IsNotEmpty()
  refreshToken!: string;
}
