#import <Cocoa/Cocoa.h>
#import <WebKit/WebKit.h>
#import <signal.h>

static NSString * const ServiceLabel = @"local.clash-traffic.collector";
static NSString * const HomeURL = @"http://127.0.0.1:19797";

@interface TrafficApp : NSObject <NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate, NSMenuDelegate, NSMenuItemValidation>
@property(strong) NSWindow *window;
@property(strong) WKWebView *webView;
@property(strong) NSTextField *loadingLabel;
@property(strong) NSProgressIndicator *spinner;
@property(assign) NSInteger attempts;
@property(assign) BOOL starting;
@property(strong) NSStatusItem *statusItem;
@property(strong) NSTimer *statusTimer;
@property(strong) NSMenuItem *statusHeading;
@property(strong) NSMenuItem *statusRate;
@property(strong) NSMenuItem *statusVisibilityItem;
@property(assign) BOOL pollingStatus;
@property(assign) BOOL stopping;

@end

@implementation TrafficApp
- (NSString *)serviceTarget { return [NSString stringWithFormat:@"gui/%u/%@", getuid(), ServiceLabel]; }
- (NSString *)dataPath { return [NSHomeDirectory() stringByAppendingPathComponent:@"Library/Application Support/ClashTraffic"]; }
- (NSString *)plistPath { return [NSHomeDirectory() stringByAppendingPathComponent:[@"Library/LaunchAgents/" stringByAppendingString:[ServiceLabel stringByAppendingString:@".plist"]]]; }
- (int)launchctl:(NSArray<NSString *> *)args output:(NSString **)output {
    NSTask *task = [[NSTask alloc] init];
    task.executableURL = [NSURL fileURLWithPath:@"/bin/launchctl"];
    task.arguments = args;
    NSPipe *pipe = [NSPipe pipe];
    task.standardOutput = pipe;
    task.standardError = [NSFileHandle fileHandleWithNullDevice];
    NSError *error = nil;
    if (![task launchAndReturnError:&error]) return -1;
    NSData *data = [[pipe fileHandleForReading] readDataToEndOfFile];
    [task waitUntilExit];
    if (output) *output = [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
    return task.terminationStatus;
}
- (void)stopService {
    NSString *result = nil;
    [self launchctl:@[@"print", self.serviceTarget] output:&result];
    NSRegularExpression *regex = [NSRegularExpression regularExpressionWithPattern:@"\\n\\s*pid = (\\d+)" options:0 error:nil];
    NSTextCheckingResult *match = [regex firstMatchInString:result ?: @"" options:0 range:NSMakeRange(0, result.length)];
    pid_t pid = match ? [[result substringWithRange:[match rangeAtIndex:1]] intValue] : 0;
    [self launchctl:@[@"bootout", self.serviceTarget] output:nil];
    for (int i=0; pid>0 && i<50; i++) {
        if (kill(pid,0)!=0) break;
        [NSThread sleepForTimeInterval:0.1];
    }
}
- (BOOL)installService {
    NSFileManager *fm = [NSFileManager defaultManager];
    NSString *executable = [[[NSBundle mainBundle] resourcePath] stringByAppendingPathComponent:@"service/clash-traffic-service"];
    if (![fm isExecutableFileAtPath:executable]) return NO;
    NSDictionary *permissions = @{NSFilePosixPermissions:@0700};
    if (![fm createDirectoryAtPath:self.dataPath withIntermediateDirectories:YES attributes:permissions error:nil]) return NO;
    [fm createDirectoryAtPath:[self.plistPath stringByDeletingLastPathComponent] withIntermediateDirectories:YES attributes:nil error:nil];
    NSDictionary *config = @{@"Label":ServiceLabel,
        @"ProgramArguments":@[executable,@"--data-dir",self.dataPath],
        @"WorkingDirectory":self.dataPath,@"RunAtLoad":@YES,@"KeepAlive":@YES,
        @"ThrottleInterval":@15,@"ProcessType":@"Background",
        @"EnvironmentVariables":@{@"PYTHONUNBUFFERED":@"1",@"PYTHONDONTWRITEBYTECODE":@"1"},
        @"StandardOutPath":@"/dev/null",@"StandardErrorPath":@"/dev/null"};
    NSDictionary *previous = [NSDictionary dictionaryWithContentsOfFile:self.plistPath];
    if (![previous isEqual:config]) {
        [self stopService];
        if (![config writeToFile:self.plistPath atomically:YES]) return NO;
        [fm setAttributes:@{NSFilePosixPermissions:@0600} ofItemAtPath:self.plistPath error:nil];
    }
    if ([self launchctl:@[@"print",self.serviceTarget] output:nil]!=0) {
        [self launchctl:@[@"bootstrap",[NSString stringWithFormat:@"gui/%u",getuid()],self.plistPath] output:nil];
    }
    [self launchctl:@[@"kickstart",self.serviceTarget] output:nil];
    return YES;
}
- (void)addItem:(NSMenu *)menu title:(NSString *)title action:(SEL)action key:(NSString *)key {
    NSMenuItem *item = [[NSMenuItem alloc] initWithTitle:title action:action keyEquivalent:key];
    item.target = self;
    [menu addItem:item];
}
- (void)createMenus {
    NSMenu *bar = [[NSMenu alloc] init];
    NSMenuItem *appItem = [[NSMenuItem alloc] init];
    [bar addItem:appItem];
    NSMenu *app = [[NSMenu alloc] initWithTitle:@"Clash 流量簿"];
    [self addItem:app title:@"关于 Clash 流量簿" action:@selector(showAbout:) key:@""];
    [app addItem:[NSMenuItem separatorItem]];
    [self addItem:app title:@"存储设置…" action:@selector(showSettings:) key:@","];
    [app addItem:[NSMenuItem separatorItem]];
    NSMenuItem *hide = [[NSMenuItem alloc] initWithTitle:@"隐藏 Clash 流量簿" action:@selector(hide:) keyEquivalent:@"h"];
    [app addItem:hide];
    [self addItem:app title:@"退出 Clash 流量簿（后台继续记录）" action:@selector(quit:) key:@"q"];
    appItem.submenu = app;
    NSMenuItem *editItem = [[NSMenuItem alloc] initWithTitle:@"编辑" action:nil keyEquivalent:@""];
    NSMenu *edit = [[NSMenu alloc] initWithTitle:@"编辑"];
    for (NSArray *spec in @[@[@"撤销",@"undo:",@"z"],@[@"剪切",@"cut:",@"x"],@[@"复制",@"copy:",@"c"],@[@"粘贴",@"paste:",@"v"],@[@"全选",@"selectAll:",@"a"]]) {
        [edit addItem:[[NSMenuItem alloc] initWithTitle:spec[0] action:NSSelectorFromString(spec[1]) keyEquivalent:spec[2]]];
    }
    editItem.submenu=edit;[bar addItem:editItem];
    NSMenuItem *viewItem = [[NSMenuItem alloc] initWithTitle:@"显示" action:nil keyEquivalent:@""];
    NSMenu *view = [[NSMenu alloc] initWithTitle:@"显示"];
    self.statusVisibilityItem=[[NSMenuItem alloc] initWithTitle:@"显示菜单栏图标" action:@selector(toggleStatusItem:) keyEquivalent:@""];
    self.statusVisibilityItem.target=self;[view addItem:self.statusVisibilityItem];
    [view addItem:[NSMenuItem separatorItem]];
    [self addItem:view title:@"显示主窗口" action:@selector(showWindow:) key:@"0"];
    [self addItem:view title:@"刷新统计界面" action:@selector(reload:) key:@"r"];
    [self addItem:view title:@"导出当前明细…" action:@selector(exportCSV:) key:@"e"];
    viewItem.submenu=view;[bar addItem:viewItem];
    NSMenuItem *serviceItem = [[NSMenuItem alloc] initWithTitle:@"记录服务" action:nil keyEquivalent:@""];
    NSMenu *service = [[NSMenu alloc] initWithTitle:@"记录服务"];
    [self addItem:service title:@"启动后台记录" action:@selector(startRecording:) key:@""];
    [self addItem:service title:@"停止本次后台记录" action:@selector(stopRecording:) key:@""];
    [service addItem:[NSMenuItem separatorItem]];
    [self addItem:service title:@"打开数据文件夹" action:@selector(openData:) key:@""];
    [self addItem:service title:@"卸载后台服务（保留历史）…" action:@selector(uninstallService:) key:@""];
    serviceItem.submenu=service;[bar addItem:serviceItem];
    NSMenuItem *helpItem=[[NSMenuItem alloc] initWithTitle:@"帮助" action:nil keyEquivalent:@""];
    NSMenu *help=[[NSMenu alloc] initWithTitle:@"帮助"];
    for (NSString *title in @[@"使用文档",@"运行文档",@"系统说明",@"聚合规则"]) {
        [self addItem:help title:title action:@selector(openManual:) key:@""];
    }
    helpItem.submenu=help;[bar addItem:helpItem];
    NSApp.mainMenu=bar;
}
- (void)createStatusItem {
    [[NSUserDefaults standardUserDefaults] registerDefaults:@{@"ShowMenuBarIcon":@YES}];
    self.statusItem=[[NSStatusBar systemStatusBar] statusItemWithLength:NSSquareStatusItemLength];
    NSImage *icon=[NSImage imageWithSize:NSMakeSize(18,18) flipped:NO drawingHandler:^BOOL(NSRect rect) {
        [[NSColor blackColor] setFill];
        for (NSValue *value in @[[NSValue valueWithRect:NSMakeRect(2,4,3,8)],
                                  [NSValue valueWithRect:NSMakeRect(7.5,2,3,14)],
                                  [NSValue valueWithRect:NSMakeRect(13,4,3,10)]]) {
            [[NSBezierPath bezierPathWithRoundedRect:value.rectValue xRadius:1.5 yRadius:1.5] fill];
        }
        return YES;
    }];
    icon.template=YES;self.statusItem.button.image=icon;
    self.statusItem.button.imagePosition=NSImageOnly;
    self.statusItem.button.toolTip=@"Clash 流量簿";
    self.statusItem.button.accessibilityLabel=@"Clash 流量簿菜单栏";
    NSMenu *menu=[[NSMenu alloc] initWithTitle:@"Clash 流量簿"];
    menu.delegate=self;
    self.statusHeading=[[NSMenuItem alloc] initWithTitle:@"正在连接记录器…" action:nil keyEquivalent:@""];
    self.statusRate=[[NSMenuItem alloc] initWithTitle:@"上传 / 下载速率暂不可用" action:nil keyEquivalent:@""];
    [menu addItem:self.statusHeading];[menu addItem:self.statusRate];
    [menu addItem:[NSMenuItem separatorItem]];
    [self addItem:menu title:@"打开流量统计" action:@selector(showWindow:) key:@""];
    [self addItem:menu title:@"存储设置…" action:@selector(showSettings:) key:@""];
    [menu addItem:[NSMenuItem separatorItem]];
    [self addItem:menu title:@"启动后台记录" action:@selector(startRecording:) key:@""];
    [self addItem:menu title:@"停止本次后台记录" action:@selector(stopRecording:) key:@""];
    [self addItem:menu title:@"打开数据文件夹" action:@selector(openData:) key:@""];
    [menu addItem:[NSMenuItem separatorItem]];
    [self addItem:menu title:@"退出 Clash 流量簿（后台继续记录）" action:@selector(quit:) key:@""];
    self.statusItem.menu=menu;
    [self applyStatusVisibility];
    self.statusTimer=[NSTimer timerWithTimeInterval:5 target:self selector:@selector(refreshStatusItem) userInfo:nil repeats:YES];
    self.statusTimer.tolerance=1;
    [[NSRunLoop mainRunLoop] addTimer:self.statusTimer forMode:NSRunLoopCommonModes];
    [self refreshStatusItem];
}
- (void)applyStatusVisibility {
    BOOL visible=[[NSUserDefaults standardUserDefaults] boolForKey:@"ShowMenuBarIcon"];
    self.statusItem.visible=visible;self.statusVisibilityItem.state=visible?NSControlStateValueOn:NSControlStateValueOff;
}
- (void)toggleStatusItem:(id)sender {
    [[NSUserDefaults standardUserDefaults] setBool:!self.statusItem.visible forKey:@"ShowMenuBarIcon"];
    [self applyStatusVisibility];
}
- (NSString *)formatRate:(double)value {
    double number=isfinite(value)?MAX(0,value):0;NSArray *units=@[@"B/s",@"KB/s",@"MB/s",@"GB/s"];
    NSUInteger index=0;while(number>=1024 && index<units.count-1){number/=1024;index++;}
    return [NSString stringWithFormat:index?@"%.1f %@":@"%.0f %@",number,units[index]];
}
- (void)refreshStatusItem {
    if(self.pollingStatus)return;
    self.pollingStatus=YES;
    NSMutableURLRequest *request=[NSMutableURLRequest requestWithURL:[NSURL URLWithString:[HomeURL stringByAppendingString:@"/api/status"]]];
    request.timeoutInterval=2;request.cachePolicy=NSURLRequestReloadIgnoringLocalCacheData;
    [[[NSURLSession sharedSession] dataTaskWithRequest:request completionHandler:^(NSData *data,NSURLResponse *response,NSError *error){
        id parsed=data && !error && [(NSHTTPURLResponse *)response statusCode]==200 ? [NSJSONSerialization JSONObjectWithData:data options:0 error:nil] : nil;
        NSDictionary *status=[parsed isKindOfClass:[NSDictionary class]]?parsed:nil;
        double sample=[status[@"last_sample"] isKindOfClass:[NSNumber class]]?[status[@"last_sample"] doubleValue]:0;
        double age=NSDate.date.timeIntervalSince1970-sample;
        BOOL online=[status[@"connected"] isEqual:@YES] && [status[@"collector_alive"] isEqual:@YES] && sample>0 && age>=0 && age<8;
        double download=[status[@"download_speed"] isKindOfClass:[NSNumber class]]?[status[@"download_speed"] doubleValue]:0;
        double upload=[status[@"upload_speed"] isKindOfClass:[NSNumber class]]?[status[@"upload_speed"] doubleValue]:0;
        dispatch_async(dispatch_get_main_queue(), ^{
            self.pollingStatus=NO;
            self.statusHeading.title=online?@"Clash 流量簿 · 记录中":@"Clash 流量簿 · 采集暂停";
            self.statusRate.title=online?[NSString stringWithFormat:@"↓ %@    ↑ %@",[self formatRate:download],[self formatRate:upload]]:@"上传 / 下载速率暂不可用";
            self.statusItem.button.toolTip=[NSString stringWithFormat:@"%@\n%@",self.statusHeading.title,self.statusRate.title];
        });
    }] resume];
}
- (void)menuWillOpen:(NSMenu *)menu { [self refreshStatusItem]; }
- (BOOL)validateMenuItem:(NSMenuItem *)item {
    if(item.action==@selector(startRecording:) || item.action==@selector(stopRecording:))return !self.starting && !self.stopping;
    return YES;
}
- (void)applicationWillTerminate:(NSNotification *)notification {
    [self.statusTimer invalidate];
    if(self.statusItem)[[NSStatusBar systemStatusBar] removeStatusItem:self.statusItem];
}
- (void)applicationDidFinishLaunching:(NSNotification *)note {
    if ([[[NSBundle mainBundle] bundlePath] hasPrefix:@"/Volumes/"]) {
        NSAlert *alert=[[NSAlert alloc] init];alert.messageText=@"请先安装 Clash 流量簿";
        alert.informativeText=@"将应用拖到“应用程序”文件夹，再从那里打开。这样后台记录服务才能在退出安装盘后继续运行。";
        [alert addButtonWithTitle:@"知道了"];[alert runModal];[NSApp terminate:nil];return;
    }
    [self createMenus];
    [self createStatusItem];
    self.window=[[NSWindow alloc] initWithContentRect:NSMakeRect(0,0,1280,850)
        styleMask:NSWindowStyleMaskTitled|NSWindowStyleMaskClosable|NSWindowStyleMaskMiniaturizable|NSWindowStyleMaskResizable
        backing:NSBackingStoreBuffered defer:NO];
    self.window.title=@"Clash 流量簿";
    self.window.minSize=NSMakeSize(850,620);
    self.window.backgroundColor=[NSColor colorWithRed:0.96 green:0.97 blue:0.97 alpha:1];
    [self.window center];[self.window setFrameAutosaveName:@"ClashTrafficMain"];
    self.window.releasedWhenClosed=NO;
    WKWebViewConfiguration *configuration=[[WKWebViewConfiguration alloc] init];
    configuration.websiteDataStore=[WKWebsiteDataStore nonPersistentDataStore];
    self.webView=[[WKWebView alloc] initWithFrame:self.window.contentView.bounds configuration:configuration];
    self.webView.autoresizingMask=NSViewWidthSizable|NSViewHeightSizable;
    self.webView.navigationDelegate=self;self.webView.UIDelegate=self;self.webView.hidden=YES;
    [self.window.contentView addSubview:self.webView];
    self.loadingLabel=[NSTextField labelWithString:@"正在启动本地流量记录器…"];
    self.loadingLabel.font=[NSFont systemFontOfSize:15 weight:NSFontWeightMedium];
    self.loadingLabel.textColor=[NSColor secondaryLabelColor];
    self.loadingLabel.alignment=NSTextAlignmentCenter;
    self.loadingLabel.frame=NSMakeRect(340,385,600,30);
    self.loadingLabel.autoresizingMask=NSViewMinXMargin|NSViewMaxXMargin|NSViewMinYMargin|NSViewMaxYMargin;
    [self.window.contentView addSubview:self.loadingLabel];
    self.spinner=[[NSProgressIndicator alloc] initWithFrame:NSMakeRect(623,430,34,34)];
    self.spinner.style=NSProgressIndicatorStyleSpinning;
    self.spinner.autoresizingMask=NSViewMinXMargin|NSViewMaxXMargin|NSViewMinYMargin|NSViewMaxYMargin;
    [self.window.contentView addSubview:self.spinner];[self.spinner startAnimation:nil];
    [self.window makeKeyAndOrderFront:nil];[NSApp activateIgnoringOtherApps:YES];
    [self startRecording:nil];
}
- (void)startRecording:(id)sender {
    if (self.starting || self.stopping) return;
    self.starting=YES;self.attempts=0;
    dispatch_async(dispatch_get_global_queue(QOS_CLASS_UTILITY,0), ^{
        BOOL ok=[self installService];
        dispatch_async(dispatch_get_main_queue(), ^{
            if (!ok) { self.starting=NO;self.loadingLabel.stringValue=@"后台服务安装失败，请确认应用已复制到可写的应用程序目录。";return; }
            [self checkReady];
        });
    });
}
- (void)checkReady {
    self.attempts++;
    NSMutableURLRequest *request=[NSMutableURLRequest requestWithURL:[NSURL URLWithString:[HomeURL stringByAppendingString:@"/api/status"]]];
    request.timeoutInterval=1;
    NSURLSessionDataTask *task=[[NSURLSession sharedSession] dataTaskWithRequest:request completionHandler:^(NSData *data,NSURLResponse *response,NSError *error){
        dispatch_async(dispatch_get_main_queue(), ^{
            if (!error && [(NSHTTPURLResponse *)response statusCode]==200) {
                self.starting=NO;
                [self.webView loadRequest:[NSURLRequest requestWithURL:[NSURL URLWithString:HomeURL]]];return;
            }
            if (self.attempts<45) {
                if (self.attempts%10==0) {
                    dispatch_async(dispatch_get_global_queue(QOS_CLASS_UTILITY,0), ^{[self installService];});
                }
                dispatch_after(dispatch_time(DISPATCH_TIME_NOW,(int64_t)(0.4*NSEC_PER_SEC)),dispatch_get_main_queue(), ^{[self checkReady];});
            } else {
                self.starting=NO;[self.spinner stopAnimation:nil];
                self.loadingLabel.stringValue=@"记录器尚未响应。可从“记录服务”菜单重新启动，或检查系统的后台项目设置。";
            }
        });
    }];[task resume];
}
- (void)webView:(WKWebView *)webView didFinishNavigation:(WKNavigation *)navigation {
    self.webView.hidden=NO;self.loadingLabel.hidden=YES;self.spinner.hidden=YES;
    [self.spinner stopAnimation:nil];
}
- (void)webView:(WKWebView *)webView decidePolicyForNavigationAction:(WKNavigationAction *)action decisionHandler:(void (^)(WKNavigationActionPolicy))handler {
    NSURL *url=action.request.URL;
    BOOL local=[url.host isEqualToString:@"127.0.0.1"] && url.port.integerValue==19797 && [url.scheme isEqualToString:@"http"];
    if (local && [url.path hasPrefix:@"/manual/"] && [url.path.pathExtension isEqualToString:@"html"]) {
        NSString *file=url.path.lastPathComponent;
        if ([@[@"index.html",@"使用文档.html",@"运行文档.html",@"系统说明.html",@"聚合规则.html"] containsObject:file]) {
            NSString *path=[[[[NSBundle mainBundle] resourcePath] stringByAppendingPathComponent:@"docs"] stringByAppendingPathComponent:file];
            [[NSWorkspace sharedWorkspace] openURL:[NSURL fileURLWithPath:path]];
        }
        handler(WKNavigationActionPolicyCancel);return;
    }
    if (local) { handler(WKNavigationActionPolicyAllow);return; }
    if ([url.scheme isEqualToString:@"https"]) [[NSWorkspace sharedWorkspace] openURL:url];
    handler(WKNavigationActionPolicyCancel);
}
- (void)webView:(WKWebView *)webView decidePolicyForNavigationResponse:(WKNavigationResponse *)response decisionHandler:(void (^)(WKNavigationResponsePolicy))handler {
    handler([response.response.MIMEType isEqualToString:@"text/csv"]?WKNavigationResponsePolicyDownload:WKNavigationResponsePolicyAllow);
}
- (void)webView:(WKWebView *)webView navigationResponse:(WKNavigationResponse *)response didBecomeDownload:(WKDownload *)download { download.delegate=self; }
- (void)webView:(WKWebView *)webView navigationAction:(WKNavigationAction *)action didBecomeDownload:(WKDownload *)download { download.delegate=self; }
- (void)download:(WKDownload *)download decideDestinationUsingResponse:(NSURLResponse *)response suggestedFilename:(NSString *)suggestedFilename completionHandler:(void (^)(NSURL *))completionHandler {
    NSSavePanel *panel=[NSSavePanel savePanel];panel.nameFieldStringValue=suggestedFilename ?: @"clash-traffic.csv";
    [panel beginSheetModalForWindow:self.window completionHandler:^(NSModalResponse result){completionHandler(result==NSModalResponseOK?panel.URL:nil);}];
}
- (void)showWindow:(id)sender { [self.window makeKeyAndOrderFront:nil];[NSApp activateIgnoringOtherApps:YES]; }
- (void)reload:(id)sender { if(self.webView.URL) [self.webView reload];else [self startRecording:nil]; }
- (void)showSettings:(id)sender { [self showWindow:nil];[self.webView evaluateJavaScript:@"document.querySelector('#settings').click()" completionHandler:nil]; }
- (void)exportCSV:(id)sender { [self.webView evaluateJavaScript:@"document.querySelector('#export').click()" completionHandler:nil]; }
- (void)openManual:(NSMenuItem *)sender {
    NSString *path=[[[[NSBundle mainBundle] resourcePath] stringByAppendingPathComponent:@"docs"] stringByAppendingPathComponent:[sender.title stringByAppendingString:@".html"]];
    [[NSWorkspace sharedWorkspace] openURL:[NSURL fileURLWithPath:path]];
}
- (void)showAbout:(id)sender {
    NSString *version=[[NSBundle mainBundle] objectForInfoDictionaryKey:@"CFBundleShortVersionString"];
    NSAlert *alert=[[NSAlert alloc] init];
    alert.messageText=[NSString stringWithFormat:@"Clash 流量簿 %@",version ?: @""];
    alert.informativeText=@"本地代理流量统计\n\n按时间、订阅、节点和应用查看用量。关闭窗口或退出界面后，后台仍继续记录。\n\n仅在本机保存数据。连接快照可能遗漏短连接，不等同于机场账单。";
    [alert addButtonWithTitle:@"好"];[alert beginSheetModalForWindow:self.window completionHandler:nil];
}
- (void)stopRecording:(id)sender {
    if(self.starting || self.stopping)return;
    self.stopping=YES;
    dispatch_async(dispatch_get_global_queue(QOS_CLASS_UTILITY,0), ^{
        [self stopService];
        dispatch_async(dispatch_get_main_queue(), ^{self.stopping=NO;[self refreshStatusItem];});
    });
}
- (void)openData:(id)sender { [[NSWorkspace sharedWorkspace] openURL:[NSURL fileURLWithPath:self.dataPath]]; }
- (void)uninstallService:(id)sender {
    NSAlert *alert=[[NSAlert alloc] init];alert.messageText=@"卸载后台记录服务？";
    alert.informativeText=@"停止采集并移除登录启动项。统计历史和设置会保留；应用将退出。下次打开应用会重新安装记录服务。若要完全移除，请随后将应用移到废纸篓。";
    [alert addButtonWithTitle:@"取消"];[alert addButtonWithTitle:@"卸载服务"];
    [alert beginSheetModalForWindow:self.window completionHandler:^(NSModalResponse result){
        if(result!=NSAlertSecondButtonReturn)return;
        dispatch_async(dispatch_get_global_queue(QOS_CLASS_UTILITY,0), ^{[self stopService];[[NSFileManager defaultManager] removeItemAtPath:self.plistPath error:nil];dispatch_async(dispatch_get_main_queue(), ^{[NSApp terminate:nil];});});
    }];
}
- (void)quit:(id)sender { [NSApp terminate:nil]; }
- (BOOL)applicationShouldTerminateAfterLastWindowClosed:(NSApplication *)sender { return NO; }
- (BOOL)applicationShouldHandleReopen:(NSApplication *)sender hasVisibleWindows:(BOOL)visible { [self showWindow:nil];return YES; }
@end

int main(int argc,const char *argv[]) {
    @autoreleasepool {
        NSApplication *app=[NSApplication sharedApplication];
        [app setActivationPolicy:NSApplicationActivationPolicyRegular];
        TrafficApp *delegate=[[TrafficApp alloc] init];app.delegate=delegate;[app run];
    }
    return 0;
}
