import { ApiProperty } from '@nestjs/swagger';

export const DEPENDENCY_STATUSES = ['ok', 'error'] as const;
export type DependencyStatus = (typeof DEPENDENCY_STATUSES)[number];

export const OVERALL_STATUSES = ['ok', 'degraded'] as const;
export type OverallStatus = (typeof OVERALL_STATUSES)[number];

export class HealthResponseDto {
  @ApiProperty({ enum: OVERALL_STATUSES, example: 'ok' })
  status!: OverallStatus;

  @ApiProperty({ enum: DEPENDENCY_STATUSES, example: 'ok' })
  db!: DependencyStatus;

  @ApiProperty({ enum: DEPENDENCY_STATUSES, example: 'ok' })
  redis!: DependencyStatus;

  @ApiProperty({ example: '2026-09-13T08:00:00.000Z', format: 'date-time' })
  timestamp!: string;
}
