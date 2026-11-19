#import <Foundation/Foundation.h>
#import <Vision/Vision.h>
#import <CoreGraphics/CoreGraphics.h>
#import <ImageIO/ImageIO.h>
#import <math.h>

@interface AimexOcrItem : NSObject
@property (nonatomic, copy) NSString *text;
@property (nonatomic) CGFloat minX;
@property (nonatomic) CGFloat maxX;
@property (nonatomic) CGFloat minY;
@property (nonatomic) CGFloat maxY;
@property (nonatomic) CGFloat midY;
@property (nonatomic) CGFloat height;
@end

@implementation AimexOcrItem
@end

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

        NSMutableArray<AimexOcrItem *> *items = [NSMutableArray array];
        for (VNRecognizedTextObservation *obs in textReq.results) {
            VNRecognizedText *top = [[obs topCandidates:1] firstObject];
            if (!top || top.string.length == 0) continue;
            CGRect box = obs.boundingBox;
            AimexOcrItem *item = [[AimexOcrItem alloc] init];
            item.text = top.string;
            item.minX = CGRectGetMinX(box);
            item.maxX = CGRectGetMaxX(box);
            item.minY = CGRectGetMinY(box);
            item.maxY = CGRectGetMaxY(box);
            item.midY = CGRectGetMidY(box);
            item.height = box.size.height;
            [items addObject:item];
        }

        NSArray<AimexOcrItem *> *sorted = [items sortedArrayUsingComparator:^NSComparisonResult(AimexOcrItem *a, AimexOcrItem *b) {
            CGFloat tol = fmax(0.004, fmin(a.height, b.height) * 0.42);
            if (fabs(a.midY - b.midY) > tol) {
                return a.midY > b.midY ? NSOrderedAscending : NSOrderedDescending;
            }
            return a.minX < b.minX ? NSOrderedAscending : NSOrderedDescending;
        }];

        NSMutableArray<NSMutableArray<AimexOcrItem *> *> *rows = [NSMutableArray array];
        NSMutableArray<AimexOcrItem *> *currentRow = [NSMutableArray array];
        CGFloat anchorY = -1.0;
        CGFloat anchorMinY = 0.0;
        CGFloat anchorMaxY = 0.0;
        CGFloat anchorH = 0.015;

        for (AimexOcrItem *item in sorted) {
            if (currentRow.count == 0) {
                [currentRow addObject:item];
                anchorY = item.midY;
                anchorMinY = item.minY;
                anchorMaxY = item.maxY;
                anchorH = fmax(0.006, item.height);
                continue;
            }

            CGFloat minH = fmax(0.006, fmin(anchorH, item.height));
            CGFloat tol = fmax(0.004, minH * 0.42);
            CGFloat vOverlap = fmin(anchorMaxY, item.maxY) - fmax(anchorMinY, item.minY);
            BOOL sameRowBand = (fabs(item.midY - anchorY) <= tol) && (vOverlap >= (minH * 0.35));

            BOOL stacksVertically = NO;
            if (sameRowBand) {
                CGFloat itemW = fmax(0.001, item.maxX - item.minX);
                for (AimexOcrItem *r in currentRow) {
                    CGFloat rW = fmax(0.001, r.maxX - r.minX);
                    CGFloat hOverlap = fmin(r.maxX, item.maxX) - fmax(r.minX, item.minX);
                    if (hOverlap > (fmin(rW, itemW) * 0.25)) {
                        stacksVertically = YES;
                        break;
                    }
                }
            }

            if (sameRowBand && !stacksVertically) {
                [currentRow addObject:item];
            } else {
                [rows addObject:currentRow];
                currentRow = [NSMutableArray arrayWithObject:item];
                anchorY = item.midY;
                anchorMinY = item.minY;
                anchorMaxY = item.maxY;
                anchorH = fmax(0.006, item.height);
            }
        }
        if (currentRow.count > 0) {
            [rows addObject:currentRow];
        }

        for (NSMutableArray<AimexOcrItem *> *row in rows) {
            [row sortUsingComparator:^NSComparisonResult(AimexOcrItem *a, AimexOcrItem *b) {
                return a.minX < b.minX ? NSOrderedAscending : NSOrderedDescending;
            }];

            NSMutableString *lineStr = [NSMutableString string];
            for (NSUInteger i = 0; i < row.count; i++) {
                AimexOcrItem *curr = row[i];
                if (i > 0) {
                    AimexOcrItem *prev = row[i - 1];
                    CGFloat gap = curr.minX - prev.maxX;
                    CGFloat colThreshold = fmax(prev.height, curr.height) * 2.5;
                    [lineStr appendString:(gap > colThreshold) ? @"\t" : @" "];
                }
                [lineStr appendString:curr.text];
            }
            printf("%s\n", [lineStr UTF8String]);
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
