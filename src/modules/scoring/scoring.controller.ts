import { Body, Controller, Get, HttpStatus, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ComputeScoreDto } from './dto/compute-score.dto';
import { ScoreResponseDto } from './dto/score-response.dto';
import { ScoringService } from './scoring.service';

const ITEM_ID_PARAM = 'id';

const NOT_FOUND_ITEM_RESPONSE = {
  status: HttpStatus.NOT_FOUND,
  description: 'No such item for this user',
};

const UNAUTHORIZED_RESPONSE = {
  status: HttpStatus.UNAUTHORIZED,
  description: 'Missing or invalid access token',
};

/**
 * Score routes live under `/items/:id` because a score is always of one item,
 * but the module owns them rather than ItemsController — scoring, pauses and
 * AI each attach to an item without the items module importing them.
 */
@ApiTags('scoring')
@ApiBearerAuth()
@Controller('items')
export class ScoringController {
  constructor(private readonly scoringService: ScoringService) {}

  @Post(`:${ITEM_ID_PARAM}/score`)
  @ApiOperation({
    summary: 'Compute (or recompute) the Regret Risk score for an item',
    description:
      'Requires WISHLIST or PAUSED. Recomputing replaces the existing RegretScore row rather than ' +
      'inserting a second one. `similarOwned` is self-reported in V1.',
  })
  @ApiParam({ name: ITEM_ID_PARAM, format: 'uuid' })
  @ApiResponse({ status: HttpStatus.CREATED, type: ScoreResponseDto })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Validation failed, or the item is past the point where it can be scored',
  })
  @ApiResponse(UNAUTHORIZED_RESPONSE)
  @ApiResponse(NOT_FOUND_ITEM_RESPONSE)
  score(
    @CurrentUser() userId: string,
    @Param(ITEM_ID_PARAM, ParseUUIDPipe) itemId: string,
    @Body() dto: ComputeScoreDto,
  ): Promise<ScoreResponseDto> {
    return this.scoringService.scoreItem(userId, itemId, dto);
  }

  @Get(`:${ITEM_ID_PARAM}/score`)
  @ApiOperation({ summary: 'Fetch the most recently computed Regret Risk score' })
  @ApiParam({ name: ITEM_ID_PARAM, format: 'uuid' })
  @ApiResponse({ status: HttpStatus.OK, type: ScoreResponseDto })
  @ApiResponse(UNAUTHORIZED_RESPONSE)
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'No such item for this user, or the item has never been scored',
  })
  getScore(
    @CurrentUser() userId: string,
    @Param(ITEM_ID_PARAM, ParseUUIDPipe) itemId: string,
  ): Promise<ScoreResponseDto> {
    return this.scoringService.getScore(userId, itemId);
  }
}
