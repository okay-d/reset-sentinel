import { Module } from '@nestjs/common'
import { FetcherService } from './fetcher.service'
import { CrawlerService } from './crawler.service'
import { KeywordsModule } from '../keywords/keywords.module'

@Module({
  imports: [KeywordsModule],
  providers: [FetcherService, CrawlerService],
  exports: [FetcherService],
})
export class FetcherModule {}
