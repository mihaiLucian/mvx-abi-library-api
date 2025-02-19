import { Module } from "@nestjs/common";
import { GoogleAiService } from "./google-ai.service";

@Module({
    imports: [],
    controllers: [],
    providers: [GoogleAiService],
    exports: [GoogleAiService],
})
export class GoogleAiModule {}