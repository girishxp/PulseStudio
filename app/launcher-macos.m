#import <Cocoa/Cocoa.h>
#include <errno.h>
#include <signal.h>
#include <unistd.h>

static NSString *const LauncherScriptName = @"Start PulseStudio - macOS.command";
static NSString *const StatusPrefix = @"PULSE_STATUS: ";

static NSString *PackageRoot(void) {
    return [NSBundle.mainBundle.bundlePath stringByDeletingLastPathComponent];
}

static NSString *LayoutError(NSString *root, NSString **version) {
    NSFileManager *files = NSFileManager.defaultManager;
    BOOL isDirectory = NO;
    NSString *script = [root stringByAppendingPathComponent:LauncherScriptName];
    if (![files fileExistsAtPath:script isDirectory:&isDirectory] || isDirectory) {
        return @"The macOS launch script is missing. Extract the complete PulseStudio ZIP and keep PulseStudio.app beside the app folder and launch scripts.";
    }
    NSString *packagePath = [root stringByAppendingPathComponent:@"app/package.json"];
    NSData *data = [NSData dataWithContentsOfFile:packagePath];
    NSError *error = nil;
    id package = data ? [NSJSONSerialization JSONObjectWithData:data options:0 error:&error] : nil;
    if (![package isKindOfClass:NSDictionary.class] || ![package[@"version"] isKindOfClass:NSString.class] || [package[@"version"] length] == 0) {
        return @"The PulseStudio application folder is missing or incomplete. Extract the complete ZIP again, then open PulseStudio.app from inside that folder.";
    }
    if (version) *version = package[@"version"];
    return nil;
}

@interface PulseLauncher : NSObject <NSApplicationDelegate, NSWindowDelegate>
@property(nonatomic, strong) NSWindow *window;
@property(nonatomic, strong) NSTextField *statusLabel;
@property(nonatomic, strong) NSProgressIndicator *spinner;
@property(nonatomic, strong) NSButton *cancelButton;
@property(nonatomic, strong) NSTimer *activityTimer;
@property(nonatomic, strong) NSTask *task;
@property(nonatomic, strong) NSPipe *outputPipe;
@property(nonatomic, strong) NSMutableData *pendingOutput;
@property(nonatomic, strong) NSMutableString *outputTail;
@property(nonatomic, copy) NSString *root;
@property(nonatomic, assign) BOOL outputEnded;
@property(nonatomic, assign) BOOL taskEnded;
@property(nonatomic, assign) BOOL completionHandled;
@property(nonatomic, assign) BOOL cancelRequested;
@property(nonatomic, assign) BOOL openingApplication;
@property(nonatomic, strong) NSDate *lastActivity;
@property(nonatomic, copy) NSString *lastStatus;
@property(nonatomic, assign) int taskStatus;
@end

@implementation PulseLauncher

- (void)applicationDidFinishLaunching:(NSNotification *)notification {
    self.root = PackageRoot();
    self.pendingOutput = [NSMutableData data];
    self.outputTail = [NSMutableString string];
    [self createWindow];
    [NSApp activateIgnoringOtherApps:YES];
    NSString *layoutError = LayoutError(self.root, NULL);
    if (layoutError) {
        [self showFailure:layoutError status:1];
        return;
    }
    [self launchScript];
}

- (void)createWindow {
    self.window = [[NSWindow alloc] initWithContentRect:NSMakeRect(0, 0, 520, 220)
                                            styleMask:NSWindowStyleMaskTitled | NSWindowStyleMaskMiniaturizable
                                              backing:NSBackingStoreBuffered
                                                defer:NO];
    self.window.title = @"PulseStudio";
    self.window.delegate = self;
    self.window.releasedWhenClosed = NO;
    NSView *content = self.window.contentView;

    NSImageView *icon = [[NSImageView alloc] initWithFrame:NSZeroRect];
    icon.image = NSApp.applicationIconImage;
    icon.imageScaling = NSImageScaleProportionallyUpOrDown;
    icon.translatesAutoresizingMaskIntoConstraints = NO;
    [content addSubview:icon];

    NSTextField *title = [NSTextField labelWithString:@"PulseStudio"];
    title.font = [NSFont systemFontOfSize:22 weight:NSFontWeightSemibold];
    title.translatesAutoresizingMaskIntoConstraints = NO;
    [content addSubview:title];

    self.statusLabel = [NSTextField wrappingLabelWithString:@"Preparing your application…"];
    self.statusLabel.font = [NSFont systemFontOfSize:13];
    self.statusLabel.textColor = NSColor.secondaryLabelColor;
    self.statusLabel.translatesAutoresizingMaskIntoConstraints = NO;
    [content addSubview:self.statusLabel];

    self.spinner = [[NSProgressIndicator alloc] initWithFrame:NSZeroRect];
    self.spinner.style = NSProgressIndicatorStyleSpinning;
    self.spinner.controlSize = NSControlSizeRegular;
    self.spinner.indeterminate = YES;
    self.spinner.translatesAutoresizingMaskIntoConstraints = NO;
    [content addSubview:self.spinner];
    [self.spinner startAnimation:nil];

    NSButton *logButton = [NSButton buttonWithTitle:@"Open Setup Log" target:self action:@selector(openLog:)];
    logButton.bezelStyle = NSBezelStyleRounded;
    logButton.translatesAutoresizingMaskIntoConstraints = NO;
    [content addSubview:logButton];

    self.cancelButton = [NSButton buttonWithTitle:@"Cancel Setup" target:self action:@selector(cancelSetup:)];
    self.cancelButton.bezelStyle = NSBezelStyleRounded;
    self.cancelButton.translatesAutoresizingMaskIntoConstraints = NO;
    [content addSubview:self.cancelButton];

    [NSLayoutConstraint activateConstraints:@[
        [icon.leadingAnchor constraintEqualToAnchor:content.leadingAnchor constant:28],
        [icon.topAnchor constraintEqualToAnchor:content.topAnchor constant:30],
        [icon.widthAnchor constraintEqualToConstant:58],
        [icon.heightAnchor constraintEqualToConstant:58],
        [title.leadingAnchor constraintEqualToAnchor:icon.trailingAnchor constant:18],
        [title.topAnchor constraintEqualToAnchor:content.topAnchor constant:36],
        [title.trailingAnchor constraintLessThanOrEqualToAnchor:content.trailingAnchor constant:-28],
        [self.spinner.leadingAnchor constraintEqualToAnchor:title.leadingAnchor],
        [self.spinner.topAnchor constraintEqualToAnchor:title.bottomAnchor constant:18],
        [self.spinner.widthAnchor constraintEqualToConstant:20],
        [self.spinner.heightAnchor constraintEqualToConstant:20],
        [self.statusLabel.leadingAnchor constraintEqualToAnchor:self.spinner.trailingAnchor constant:12],
        [self.statusLabel.topAnchor constraintEqualToAnchor:self.spinner.topAnchor constant:1],
        [self.statusLabel.trailingAnchor constraintEqualToAnchor:content.trailingAnchor constant:-28],
        [self.statusLabel.bottomAnchor constraintLessThanOrEqualToAnchor:logButton.topAnchor constant:-16],
        [logButton.trailingAnchor constraintEqualToAnchor:self.cancelButton.leadingAnchor constant:-12],
        [logButton.centerYAnchor constraintEqualToAnchor:self.cancelButton.centerYAnchor],
        [self.cancelButton.trailingAnchor constraintEqualToAnchor:content.trailingAnchor constant:-28],
        [self.cancelButton.bottomAnchor constraintEqualToAnchor:content.bottomAnchor constant:-20]
    ]];
    [self.window center];
    [self.window makeKeyAndOrderFront:nil];
}

- (void)launchScript {
    self.task = [[NSTask alloc] init];
    // Create a private process group before zsh starts. Cancellation targets only
    // this setup, never another PulseStudio or Electron process on the Mac.
    self.task.executableURL = NSBundle.mainBundle.executableURL;
    self.task.arguments = @[@"--run-script", [self.root stringByAppendingPathComponent:LauncherScriptName]];
    self.task.currentDirectoryURL = [NSURL fileURLWithPath:self.root isDirectory:YES];
    self.task.standardInput = [NSFileHandle fileHandleWithNullDevice];
    self.outputPipe = [NSPipe pipe];
    self.task.standardOutput = self.outputPipe;
    self.task.standardError = self.outputPipe;
    __weak PulseLauncher *weakSelf = self;
    self.outputPipe.fileHandleForReading.readabilityHandler = ^(NSFileHandle *handle) {
        NSData *data = handle.availableData;
        if (data.length == 0) handle.readabilityHandler = nil;
        dispatch_async(dispatch_get_main_queue(), ^{
            PulseLauncher *launcher = weakSelf;
            if (!launcher || launcher.completionHandled) return;
            if (data.length > 0) {
                [launcher receiveOutput:data];
            } else {
                launcher.outputEnded = YES;
                [launcher finishIfReady];
            }
        });
    };
    self.task.terminationHandler = ^(NSTask *task) {
        int status = task.terminationStatus;
        dispatch_async(dispatch_get_main_queue(), ^{
            PulseLauncher *launcher = weakSelf;
            if (!launcher || launcher.completionHandled) return;
            launcher.taskStatus = status;
            launcher.taskEnded = YES;
            [launcher finishIfReady];
            // A descendant can inherit the pipe and prevent EOF after the shell
            // stops. That must not leave the preparation window up forever.
            dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 3 * NSEC_PER_SEC), dispatch_get_main_queue(), ^{
                if (launcher.completionHandled || launcher.outputEnded) return;
                launcher.outputPipe.fileHandleForReading.readabilityHandler = nil;
                launcher.outputEnded = YES;
                [launcher finishIfReady];
            });
        });
    };
    NSError *error = nil;
    if (![self.task launchAndReturnError:&error]) {
        self.outputPipe.fileHandleForReading.readabilityHandler = nil;
        [self showFailure:[NSString stringWithFormat:@"The PulseStudio launch script could not start. %@", error.localizedDescription] status:1];
        return;
    }
    // The parent must release its copy so the reader receives EOF when zsh ends.
    [self.outputPipe.fileHandleForWriting closeFile];
    self.lastActivity = NSDate.date;
    self.activityTimer = [NSTimer scheduledTimerWithTimeInterval:10 target:self selector:@selector(checkActivity:) userInfo:nil repeats:YES];
}

- (void)checkActivity:(NSTimer *)timer {
    (void)timer;
    if (self.completionHandled || self.cancelRequested || self.openingApplication) return;
    if (-self.lastActivity.timeIntervalSinceNow >= 180) {
        self.statusLabel.stringValue = @"Setup has not reported progress for 3 minutes. Open the log for details, or cancel and try again.";
    }
}

- (void)openLog:(id)sender {
    (void)sender;
    NSString *logPath = [NSHomeDirectory() stringByAppendingPathComponent:@"Library/Logs/PulseStudio/launcher.log"];
    if ([NSFileManager.defaultManager fileExistsAtPath:logPath]) {
        [NSWorkspace.sharedWorkspace openURL:[NSURL fileURLWithPath:logPath]];
    } else {
        self.statusLabel.stringValue = @"The setup log is not ready yet. You can cancel setup at any time.";
    }
}

- (void)cancelSetup:(id)sender {
    (void)sender;
    if (self.cancelRequested || self.completionHandled || self.openingApplication) return;
    self.cancelRequested = YES;
    self.cancelButton.enabled = NO;
    self.statusLabel.stringValue = @"Cancelling setup…";
    [self.activityTimer invalidate];
    if (self.task.isRunning) {
        pid_t setupPID = self.task.processIdentifier;
        if (kill(-setupPID, SIGTERM) != 0 && errno == ESRCH) [self.task terminate];
        __weak PulseLauncher *weakSelf = self;
        dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 5 * NSEC_PER_SEC), dispatch_get_main_queue(), ^{
            PulseLauncher *launcher = weakSelf;
            if (!launcher || launcher.completionHandled || !launcher.task.isRunning) return;
            kill(-setupPID, SIGKILL);
        });
    } else {
        self.completionHandled = YES;
        [NSApp terminate:nil];
    }
}

- (NSApplicationTerminateReply)applicationShouldTerminate:(NSApplication *)sender {
    (void)sender;
    if (!self.completionHandled && self.task.isRunning) {
        if (!self.openingApplication) [self cancelSetup:nil];
        return NSTerminateCancel;
    }
    return NSTerminateNow;
}

- (void)receiveOutput:(NSData *)data {
    self.lastActivity = NSDate.date;
    if (!self.cancelRequested && self.lastStatus.length > 0) self.statusLabel.stringValue = self.lastStatus;
    [self.pendingOutput appendData:data];
    const unsigned char *bytes = self.pendingOutput.bytes;
    NSUInteger length = self.pendingOutput.length;
    NSUInteger consumed = 0;
    for (NSUInteger index = 0; index < length; index++) {
        if (bytes[index] != '\n') continue;
        NSData *lineData = [self.pendingOutput subdataWithRange:NSMakeRange(consumed, index - consumed)];
        NSString *line = [[NSString alloc] initWithData:lineData encoding:NSUTF8StringEncoding];
        if (!line) line = [[NSString alloc] initWithData:lineData encoding:NSISOLatin1StringEncoding];
        [self consumeLine:line ?: @""];
        consumed = index + 1;
    }
    if (consumed > 0) [self.pendingOutput replaceBytesInRange:NSMakeRange(0, consumed) withBytes:NULL length:0];
    // A malformed dependency's unbroken output should not grow this UI indefinitely.
    if (self.pendingOutput.length > 32768) {
        NSData *fragment = [self.pendingOutput subdataWithRange:NSMakeRange(0, 16384)];
        NSString *text = [[NSString alloc] initWithData:fragment encoding:NSUTF8StringEncoding];
        [self consumeLine:text ?: @"(Dependency output exceeded the launcher display limit.)"];
        [self.pendingOutput replaceBytesInRange:NSMakeRange(0, 16384) withBytes:NULL length:0];
    }
}

- (void)consumeLine:(NSString *)line {
    NSString *cleanLine = [line stringByTrimmingCharactersInSet:NSCharacterSet.newlineCharacterSet];
    [self.outputTail appendFormat:@"%@\n", cleanLine];
    if (self.outputTail.length > 16000) [self.outputTail deleteCharactersInRange:NSMakeRange(0, self.outputTail.length - 16000)];
    if ([cleanLine hasPrefix:StatusPrefix]) {
        NSString *status = [[cleanLine substringFromIndex:StatusPrefix.length] stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet];
        if (status.length > 0) {
            self.lastStatus = status;
            if (!self.cancelRequested) self.statusLabel.stringValue = status;
            if ([status hasPrefix:@"Opening PulseStudio"]) {
                self.openingApplication = YES;
                self.cancelButton.enabled = NO;
            }
        }
    }
}

- (void)finishIfReady {
    if (!self.taskEnded || !self.outputEnded || self.completionHandled) return;
    [self.activityTimer invalidate];
    if (self.pendingOutput.length > 0) {
        NSString *lastLine = [[NSString alloc] initWithData:self.pendingOutput encoding:NSUTF8StringEncoding];
        [self consumeLine:lastLine ?: @""];
        [self.pendingOutput setLength:0];
    }
    if (self.cancelRequested || self.taskStatus == 0) {
        self.completionHandled = YES;
        [NSApp terminate:nil];
    } else {
        NSString *details = [self.outputTail stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet];
        if (details.length == 0) details = [NSString stringWithFormat:@"The launcher stopped with exit code %d. Open the launcher log for details.", self.taskStatus];
        [self showFailure:details status:self.taskStatus];
    }
}

- (void)showFailure:(NSString *)details status:(int)status {
    self.completionHandled = YES;
    [self.activityTimer invalidate];
    self.cancelButton.enabled = NO;
    [self.spinner stopAnimation:nil];
    self.statusLabel.stringValue = @"PulseStudio could not start.";
    NSString *logPath = [NSHomeDirectory() stringByAppendingPathComponent:@"Library/Logs/PulseStudio/launcher.log"];
    if (![NSFileManager.defaultManager fileExistsAtPath:logPath]) {
        [NSFileManager.defaultManager createDirectoryAtPath:logPath.stringByDeletingLastPathComponent withIntermediateDirectories:YES attributes:nil error:NULL];
        [details writeToFile:logPath atomically:YES encoding:NSUTF8StringEncoding error:NULL];
    }
    NSString *shownDetails = details;
    if (shownDetails.length > 2500) shownDetails = [@"…\n" stringByAppendingString:[shownDetails substringFromIndex:shownDetails.length - 2500]];
    for (;;) {
        NSAlert *alert = [[NSAlert alloc] init];
        alert.alertStyle = NSAlertStyleWarning;
        alert.messageText = @"PulseStudio could not start";
        alert.informativeText = shownDetails;
        [alert addButtonWithTitle:@"Open Launcher Log"];
        if (status == 20) [alert addButtonWithTitle:@"Open Node Download"];
        [alert addButtonWithTitle:@"Quit"];
        NSModalResponse response = [alert runModal];
        if (response == NSAlertFirstButtonReturn) {
            [NSWorkspace.sharedWorkspace openURL:[NSURL fileURLWithPath:logPath]];
        } else if (status == 20 && response == NSAlertSecondButtonReturn) {
            [NSWorkspace.sharedWorkspace openURL:[NSURL URLWithString:@"https://nodejs.org/en/download"]];
        } else {
            break;
        }
    }
    [NSApp terminate:nil];
}

@end

int main(int argc, const char *argv[]) {
    @autoreleasepool {
        if (argc == 3 && strcmp(argv[1], "--run-script") == 0) {
            if (setpgid(0, 0) != 0) {
                fprintf(stderr, "Unable to isolate the setup process: %s\n", strerror(errno));
                return 1;
            }
            execl("/bin/zsh", "zsh", argv[2], "--gui", (char *)NULL);
            fprintf(stderr, "Unable to start the setup script: %s\n", strerror(errno));
            return 1;
        }
        if (argc > 1 && strcmp(argv[1], "--check-layout") == 0) {
            NSString *root = PackageRoot();
            NSString *version = nil;
            NSString *error = LayoutError(root, &version);
            if (error) {
                fprintf(stderr, "%s\n", error.UTF8String);
                return 1;
            }
            NSData *data = [NSJSONSerialization dataWithJSONObject:@{@"root":root, @"version":version, @"launcher":[root stringByAppendingPathComponent:LauncherScriptName]} options:0 error:NULL];
            puts([[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding].UTF8String);
            return 0;
        }
        NSApplication *application = NSApplication.sharedApplication;
        [application setActivationPolicy:NSApplicationActivationPolicyRegular];
        PulseLauncher *delegate = [[PulseLauncher alloc] init];
        application.delegate = delegate;
        [application run];
    }
    return 0;
}
