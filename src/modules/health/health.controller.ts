import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { HealthResponseDto } from './dto/health-response.dto';
import { HealthService } from './health.service';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  @Public()
  // Load balancers and uptime monitors poll this frequently from a handful of
  // IPs; rate limiting it would only produce false "down" alerts.
  @SkipThrottle()
  @ApiOperation({ summary: 'Liveness and dependency health check' })
  @ApiResponse({
    status: HttpStatus.OK,
    type: HealthResponseDto,
    description: 'All dependencies reachable',
  })
  @ApiResponse({
    status: HttpStatus.SERVICE_UNAVAILABLE,
    type: HealthResponseDto,
    description: 'One or more dependencies unreachable',
  })
  async check(@Res({ passthrough: true }) response: Response): Promise<HealthResponseDto> {
    const result = await this.healthService.check();

    // Same body either way; the status code is what orchestrators act on.
    response.status(result.status === 'ok' ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE);
    return result;
  }
}
