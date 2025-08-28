import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { BookOpen, FileText, Upload, Sun, Moon, List, ChevronLeft, ChevronRight, ZoomIn, ZoomOut, Bookmark } from "lucide-react";
import ePub from "epubjs";
import * as pdfjsLib from "pdfjs-dist";

// PDF.js worker 설정
// GitHub Pages 환경에서 안정적인 설정
pdfjsLib.GlobalWorkerOptions.workerSrc = ''; // Worker 비활성화하여 fake worker 사용

/**
 * 웹용 전자책 뷰어 MVP
 * - EPUB: epub.js (가변 레이아웃, 글꼴/테마/목차/진도)
 * - PDF: pdf.js (고정 레이아웃, 확대/축소/페이지 이동)
 * - 공통: 로컬 업로드 & URL 로드, 북마크, 다크 모드, 반응형 UI
 *
 * TODO (확장):
 * - 계정/진도 동기화, 주석/형광펜, 검색(EPUB), 오디오북 플레이어, DRM/토큰 스트리밍
 */

const containerBase = "rounded-2xl shadow-sm border p-2 bg-background";

function useDarkMode() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const root = document.documentElement;
    if (dark) root.classList.add("dark");
    else root.classList.remove("dark");
  }, [dark]);
  return { dark, setDark };
}

function EbookViewer() {
  const { dark, setDark } = useDarkMode();

  // 공통 상태
  const [activeTab, setActiveTab] = useState("epub");
  const [url, setUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);

  // EPUB 상태/참조
  const epubRef = useRef<HTMLDivElement | null>(null);
  const renditionRef = useRef<any>(null);
  const bookRef = useRef<any>(null);
  const [, setEpubReady] = useState(false);
  const [toc, setToc] = useState<Array<{ label: string; href: string }>>([]);
  const [fontSize, setFontSize] = useState(100);
  const [progress, setProgress] = useState(0); // 0~100
  const [locationsReady, setLocationsReady] = useState(false);
  const [bookmarks, setBookmarks] = useState<string[]>([]); // EPUB CFI 저장

  // PDF 상태/참조
  const pdfCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const pdfDocRef = useRef<any>(null);
  const [pdfPage, setPdfPage] = useState(1);
  const [pdfPages, setPdfPages] = useState(0);
  const [pdfScale, setPdfScale] = useState(1.2);

  // 파일 확장자로 탭 자동 결정(선택)
  useEffect(() => {
    if (!file) return;
    const ext = file.name.split(".").pop()?.toLowerCase();
    if (ext === "epub") setActiveTab("epub");
    else if (ext === "pdf") setActiveTab("pdf");
  }, [file]);

  // URL로 탭 결정(선택)
  useEffect(() => {
    if (!url) return;
    const u = url.toLowerCase();
    if (u.endsWith(".epub")) setActiveTab("epub");
    if (u.endsWith(".pdf")) setActiveTab("pdf");
  }, [url]);

  /** EPUB 로드 */
  const loadEpub = async (src: string | ArrayBuffer) => {
    // 기존 렌디션 정리
    try { renditionRef.current?.destroy?.(); } catch {}
    try { bookRef.current?.destroy?.(); } catch {}

    const book = ePub(src);
    bookRef.current = book;

    // 렌더링 초기화
    if (epubRef.current) {
      const rendition = book.renderTo(epubRef.current, {
        width: "100%",
        height: "100%",
        spread: "auto",
        minSpreadWidth: 900,
        manager: "continuous", // 연속 스크롤 느낌
      });
      renditionRef.current = rendition;

      rendition.themes.register("light", {
        "body": { background: "#ffffff", color: "#111827" },
      });
      rendition.themes.register("dark", {
        "body": { background: "#0b1220", color: "#e5e7eb" },
        "a": { color: "#93c5fd" },
      });
      rendition.themes.select(dark ? "dark" : "light");
      rendition.themes.fontSize(`${fontSize}%`);

      rendition.display();

      // 목차 & 위치
      book.ready.then(async () => {
        setEpubReady(true);
        const navigation = await book.navigation?.load;
        const tocItems = (navigation as any)?.toc?.map((i: any) => ({ label: i.label, href: i.href })) ?? [];
        setToc(tocItems);

        // Locations (진도율 계산)
        try {
          await book.locations.generate(1200);
          setLocationsReady(true);
        } catch (e) {
          setLocationsReady(false);
        }
      });

      rendition.on("relocated", (location: any) => {
        if (bookRef.current && locationsReady) {
          try {
            const percent = bookRef.current.locations.percentageFromCfi(location.start.cfi) * 100;
            setProgress(Math.round(percent));
          } catch {}
        }
      });
    }
  };

  /** PDF 로드 */
  const loadPdf = async (src: string | ArrayBuffer) => {
    try {
      const loadingTask = pdfjsLib.getDocument({ 
        data: typeof src !== "string" ? src : undefined, 
        url: typeof src === "string" ? src : undefined
      } as any);
      const pdf = await loadingTask.promise;
      pdfDocRef.current = pdf;
      setPdfPages(pdf.numPages);
      setPdfPage(1);
      await renderPdfPage(pdf, 1, pdfScale);
    } catch (error) {
      console.error('PDF 로드 실패:', error);
      alert('PDF 파일을 로드하는 중 오류가 발생했습니다. 파일을 확인해주세요.');
    }
  };

  const renderPdfPage = async (pdf: any, pageNum: number, scale: number) => {
    const page = await pdf.getPage(pageNum);
    const viewport = page.getViewport({ scale });
    const canvas = pdfCanvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const renderContext = { canvasContext: ctx, viewport };
    await page.render(renderContext).promise;
  };

  // 다크모드 시 EPUB 테마 변경
  useEffect(() => {
    renditionRef.current?.themes?.select(dark ? "dark" : "light");
  }, [dark]);

  // 폰트 크기 변경 시 즉시 반영
  useEffect(() => {
    renditionRef.current?.themes?.fontSize?.(`${fontSize}%`);
  }, [fontSize]);

  // 진도 슬라이더 이동
  const onSeek = async (val: number[]) => {
    const v = val[0];
    setProgress(v);
    if (bookRef.current && locationsReady) {
      const cfi = bookRef.current.locations.cfiFromPercentage(v / 100);
      await renditionRef.current.display(cfi);
    }
  };

  const goSection = async (href: string) => {
    await renditionRef.current?.display(href);
  };

  const addBookmark = async () => {
    const loc = await renditionRef.current?.currentLocation();
    const cfi = loc?.start?.cfi;
    if (!cfi) return;
    if (!bookmarks.includes(cfi)) setBookmarks((b) => [cfi, ...b]);
  };

  const goToBookmark = async (cfi: string) => {
    await renditionRef.current?.display(cfi);
  };

  const onOpen = async () => {
    try {
      if (file) {
        const buf = await file.arrayBuffer();
        if (activeTab === "epub") await loadEpub(buf);
        else await loadPdf(buf);
      } else if (url) {
        if (activeTab === "epub") await loadEpub(url);
        else await loadPdf(url);
      }
    } catch (e) {
      console.error(e);
      alert("파일을 여는 중 문제가 발생했습니다. URL 또는 파일을 확인하세요.");
    }
  };

  const pdfPrev = async () => {
    if (!pdfDocRef.current) return;
    const n = Math.max(1, pdfPage - 1);
    setPdfPage(n);
    await renderPdfPage(pdfDocRef.current, n, pdfScale);
  };
  const pdfNext = async () => {
    if (!pdfDocRef.current) return;
    const n = Math.min(pdfPages, pdfPage + 1);
    setPdfPage(n);
    await renderPdfPage(pdfDocRef.current, n, pdfScale);
  };
  const pdfZoom = async (delta: number) => {
    const s = Math.min(3, Math.max(0.5, pdfScale + delta));
    setPdfScale(s);
    if (pdfDocRef.current) await renderPdfPage(pdfDocRef.current, pdfPage, s);
  };

  return (
    <TooltipProvider>
      <div className="mx-auto max-w-6xl p-4">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-2xl font-semibold tracking-tight">전자책 뷰어 (웹용 MVP)</h1>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <Sun className="h-4 w-4" />
              <Switch checked={dark} onCheckedChange={setDark} />
              <Moon className="h-4 w-4" />
            </div>
          </div>
        </div>

        <Card className="mb-4">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">소스 선택</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="space-y-2">
              <Label>파일 업로드 (EPUB/PDF)</Label>
              <div className="flex items-center gap-2">
                <Input type="file" accept=".epub,.pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
                <Button variant="secondary" onClick={() => setFile(null)}>초기화</Button>
              </div>
            </div>
            <div className="space-y-2">
              <Label>URL 로드</Label>
              <Input placeholder="https://example.com/book.epub 또는 .pdf" value={url} onChange={(e) => setUrl(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>포맷</Label>
              <Select value={activeTab} onValueChange={setActiveTab}>
                <SelectTrigger><SelectValue placeholder="형식 선택" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="epub">EPUB (가변)</SelectItem>
                  <SelectItem value="pdf">PDF (고정)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="md:col-span-3">
              <Button className="w-full" onClick={onOpen}>
                <Upload className="mr-2 h-4 w-4" /> 열기
              </Button>
            </div>
          </CardContent>
        </Card>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="">
          <TabsList className="grid grid-cols-2 w-full mb-3">
            <TabsTrigger value="epub" className="flex items-center gap-2"><BookOpen className="h-4 w-4"/>EPUB 뷰어</TabsTrigger>
            <TabsTrigger value="pdf" className="flex items-center gap-2"><FileText className="h-4 w-4"/>PDF 뷰어</TabsTrigger>
          </TabsList>

          {/* EPUB VIEWER */}
          <TabsContent value="epub">
            <div className="grid grid-cols-1 lg:grid-cols-4 gap-3">
              {/* 사이드바: 목차 & 북마크 */}
              <div className="lg:col-span-1 space-y-3">
                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><List className="h-4 w-4"/>목차</CardTitle></CardHeader>
                  <CardContent className="max-h-[300px] overflow-auto space-y-1">
                    {toc.length === 0 && <p className="text-sm text-muted-foreground">목차가 없습니다.</p>}
                    {toc.map((i, idx) => (
                      <Button key={idx} variant="ghost" className="w-full justify-start text-sm" onClick={() => goSection(i.href)}>
                        {i.label}
                      </Button>
                    ))}
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><Bookmark className="h-4 w-4"/>북마크</CardTitle></CardHeader>
                  <CardContent className="max-h-[200px] overflow-auto space-y-1">
                    {bookmarks.length === 0 && <p className="text-sm text-muted-foreground">북마크가 없습니다.</p>}
                    {bookmarks.map((cfi, idx) => (
                      <Button key={idx} variant="secondary" className="w-full justify-start text-xs" onClick={() => goToBookmark(cfi)}>
                        {cfi}
                      </Button>
                    ))}
                  </CardContent>
                </Card>
              </div>

              {/* 본문 & 컨트롤 */}
              <div className="lg:col-span-3 space-y-3">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">읽기 설정</CardTitle>
                  </CardHeader>
                  <CardContent className="flex flex-wrap items-center gap-4">
                    <div className="flex items-center gap-3">
                      <Label className="text-xs">글자 크기</Label>
                      <Slider className="w-40" value={[fontSize]} min={80} max={180} step={5} onValueChange={(value) => setFontSize(value[0])} />
                      <span className="text-xs tabular-nums">{fontSize}%</span>
                    </div>
                    <div className="ml-auto flex items-center gap-2">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button size="sm" variant="outline" onClick={addBookmark}><Bookmark className="h-4 w-4"/></Button>
                        </TooltipTrigger>
                        <TooltipContent>현재 위치 북마크</TooltipContent>
                      </Tooltip>
                    </div>
                  </CardContent>
                </Card>

                <div className={`${containerBase} h-[65vh]`}> 
                  <div ref={epubRef} className="w-full h-full overflow-hidden rounded-xl" />
                </div>

                <Card>
                  <CardContent className="pt-4">
                    <div className="flex items-center gap-4">
                      <Label className="text-xs">진도</Label>
                      <Slider className="flex-1" value={[progress]} min={0} max={100} step={1} onValueChange={onSeek} />
                      <span className="text-xs tabular-nums w-12 text-right">{progress}%</span>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </div>
          </TabsContent>

          {/* PDF VIEWER */}
          <TabsContent value="pdf">
            <div className="space-y-3">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">페이지 & 확대</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-wrap items-center gap-3">
                  <div className="flex items-center gap-2">
                    <Button size="sm" variant="outline" onClick={pdfPrev}><ChevronLeft className="h-4 w-4"/></Button>
                    <span className="text-xs tabular-nums">{pdfPage} / {pdfPages || '-'}</span>
                    <Button size="sm" variant="outline" onClick={pdfNext}><ChevronRight className="h-4 w-4"/></Button>
                  </div>
                  <div className="flex items-center gap-2 ml-auto">
                    <Button size="sm" variant="outline" onClick={() => pdfZoom(-0.1)}><ZoomOut className="h-4 w-4"/></Button>
                    <span className="text-xs tabular-nums">{Math.round(pdfScale * 100)}%</span>
                    <Button size="sm" variant="outline" onClick={() => pdfZoom(0.1)}><ZoomIn className="h-4 w-4"/></Button>
                  </div>
                </CardContent>
              </Card>

              <div className={`${containerBase} h-[75vh] flex items-center justify-center`}>
                <canvas ref={pdfCanvasRef} className="rounded-xl max-h-full max-w-full" />
              </div>
            </div>
          </TabsContent>
        </Tabs>

        <p className="text-xs text-muted-foreground mt-6">
          * 데모 용도: 상용 서비스에는 계정 동기화, 주석/하이라이트, 오디오북, 접근성 개선(스크린리더), DRM/토큰 기반 스트리밍 등을 추가하세요.
        </p>
      </div>
    </TooltipProvider>
  );
}

function App() {
  return <EbookViewer />;
}

export default App;
