import { ServiceKey } from "@pragmatic-tech-ai/todl-runtime";
import type { AnalyzeRequest, AnalyzeResponse } from "../analysis/protocol.js";

export interface IAnalysisEngine
{
    Analyze(request: AnalyzeRequest): Promise<AnalyzeResponse>;
}

export const AnalysisEngineKey = new ServiceKey<IAnalysisEngine>("AnalysisEngine");
