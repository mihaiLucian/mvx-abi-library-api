import { Module } from "@nestjs/common";
import { AzureOpenaiService } from "./azure-openai.service";

@Module({
    imports: [],
    controllers: [],
    providers: [AzureOpenaiService],
    exports: [AzureOpenaiService],
})
export class AzureOpenaiModule {}