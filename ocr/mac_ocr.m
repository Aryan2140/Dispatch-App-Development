#import <Foundation/Foundation.h>
#import <Vision/Vision.h>
#import <CoreGraphics/CoreGraphics.h>
#import <ImageIO/ImageIO.h>

int main(int argc, const char * argv[]) {
    @autoreleasepool {
        if (argc < 2) return 1;
        NSString *path = [NSString stringWithUTF8String:argv[1]];
        NSURL *url = [NSURL fileURLWithPath:path];
        VNImageRequestHandler *handler = [[VNImageRequestHandler alloc] initWithURL:url options:@{}];

        VNRecognizeTextRequest *textReq = [[VNRecognizeTextRequest alloc] init];
        textReq.recognitionLevel = VNRequestTextRecognitionLevelAccurate;
        textReq.usesLanguageCorrection = NO;

        VNDetectBarcodesRequest *barcodeReq = [[VNDetectBarcodesRequest alloc] init];

        NSError *err = nil;
        BOOL ok = [handler performRequests:@[textReq, barcodeReq] error:&err];
        if (!ok || err) {
            return 2;
        }

        NSArray<VNRecognizedTextObservation *> *results = textReq.results;
        NSArray<VNRecognizedTextObservation *> *sorted = [results sortedArrayUsingComparator:^NSComparisonResult(VNRecognizedTextObservation *a, VNRecognizedTextObservation *b) {
            CGFloat ay = CGRectGetMidY(a.boundingBox);
            CGFloat by = CGRectGetMidY(b.boundingBox);
            if (fabs(ay - by) > 0.014) {
                return ay > by ? NSOrderedAscending : NSOrderedDescending;
            }
            CGFloat ax = CGRectGetMinX(a.boundingBox);
            CGFloat bx = CGRectGetMinX(b.boundingBox);
            return ax < bx ? NSOrderedAscending : NSOrderedDescending;
        }];

        NSMutableArray<NSString *> *lines = [NSMutableArray array];
        NSMutableString *currentLine = [NSMutableString string];
        CGFloat prevY = -1.0;

        for (VNRecognizedTextObservation *obs in sorted) {
            VNRecognizedText *top = [[obs topCandidates:1] firstObject];
            if (!top) continue;
            CGFloat midY = CGRectGetMidY(obs.boundingBox);
            if (prevY < 0 || fabs(midY - prevY) <= 0.014) {
                if (currentLine.length > 0) [currentLine appendString:@" "];
                [currentLine appendString:top.string];
            } else {
                [lines addObject:[currentLine copy]];
                [currentLine setString:top.string];
            }
            prevY = midY;
        }
        if (currentLine.length > 0) [lines addObject:[currentLine copy]];

        for (NSString *line in lines) {
            printf("%s\n", [line UTF8String]);
        }

        for (VNBarcodeObservation *bObs in barcodeReq.results) {
            NSString *payload = bObs.payloadStringValue;
            if (!payload || payload.length < 7) continue;
            NSString *cleaned = [[payload componentsSeparatedByCharactersInSet:[NSCharacterSet controlCharacterSet]] componentsJoinedByString:@""];
            cleaned = [cleaned stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
            if (cleaned.length >= 7 && cleaned.length <= 40 && [cleaned rangeOfString:@" "].location == NSNotFound) {
                printf("BARCODE_PAYLOAD: %s\n", [cleaned UTF8String]);
            }
        }
    }
    return 0;
}
