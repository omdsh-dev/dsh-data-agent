/**
 * Offline HTML artifact for one validated AnalysisReportV1.
 *
 * The generated page has no network/runtime dependencies. Untrusted report
 * strings stay inside escaped JSON and are projected with textContent only;
 * chart geometry is derived from already-validated finite numeric fields.
 * @module @yejiming/dsh-data-agent/analysis-html
 */

import { randomUUID } from 'node:crypto'
import { link, mkdir, unlink, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { AnalysisReportV1 } from './analysis.ts'

export const ANALYSIS_REPORT_DIRECTORY = 'analysis-reports'

/** Convert a report title/output name into a bounded, readable filename segment. */
export function analysisFileSegment(value: string, fallback: string): string {
  const sanitize = (candidate: string): string => candidate
    .normalize('NFKC')
    .replace(/\.html$/i, '')
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, '')
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96)
  return sanitize(value) || sanitize(fallback) || 'analysis-report'
}

/** Relative path shared by the writer and DSH's mutation presentation. */
export function analysisArtifactRelativePath(title: string, outputName?: string): string {
  const basename = analysisFileSegment(outputName ?? title, '分析报告')
  return `${ANALYSIS_REPORT_DIRECTORY}/${basename}.html`
}

/** Escape JSON so data cannot close its application/json script element. */
export function escapeJsonForHtmlScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/&/g, '\\u0026')
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
}

/** Render one complete, offline Dashboard document. */
export function renderAnalysisHtml(report: AnalysisReportV1, generatedAt = new Date().toISOString()): string {
  const data = escapeJsonForHtmlScript(report)
  const generatedAtText = escapeJsonForHtmlScript(generatedAt)
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'none'; font-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'">
  <title>DSH Data Agent Analysis</title>
  <style>
    :root{color-scheme:light dark;--bg:oklch(97.4% .006 255);--panel:oklch(99.2% .003 255);--text:oklch(27% .035 255);--muted:oklch(52% .025 255);--line:oklch(88% .012 255);--grid:oklch(92% .008 255);--accent:oklch(58% .16 255);--palette:#4e79a7,#f28e2b,#59a14f,#e15759,#76b7b2,#edc948,#b07aa1,#9c755f}
    @media(prefers-color-scheme:dark){:root{--bg:oklch(19% .018 255);--panel:oklch(23% .02 255);--text:oklch(93% .012 255);--muted:oklch(72% .018 255);--line:oklch(35% .022 255);--grid:oklch(31% .018 255);--accent:oklch(72% .13 255)}}
    *{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:14px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif}main{width:min(1440px,calc(100% - 32px));margin:0 auto;padding:24px 0 48px}header{padding-bottom:16px;margin-bottom:16px;border-bottom:1px solid var(--line)}h1{margin:0;font-size:24px;line-height:1.25;font-weight:650;letter-spacing:-.015em}header p{max-width:1120px;margin:7px 0 0;color:var(--muted)}.report-count{font-size:13px;color:var(--text)}.metric-band{display:flex;flex-wrap:wrap;gap:8px;padding-bottom:12px;margin-bottom:12px;border-bottom:1px solid var(--line)}.metric{flex:1 1 180px;min-width:150px;padding:9px 12px;background:var(--panel);border:1px solid var(--line);border-radius:8px;break-inside:avoid}.metric-label{margin:0;color:var(--muted);font-size:12px}.metric-value{margin:2px 0 0;font-size:18px;line-height:1.35;font-weight:650;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}.dashboard{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.view{min-width:0;padding:11px 12px;background:var(--panel);border:1px solid var(--line);border-radius:8px;break-inside:avoid}.view.full,.view.table{grid-column:1/-1}.view h2{font-size:13px;line-height:1.4;font-weight:650;margin:0 0 8px}.empty{padding:28px 12px;text-align:center;color:var(--muted);border:1px dashed var(--line);border-radius:7px}.chart{width:100%;height:auto;min-height:260px;display:block}.axis{stroke:var(--line);stroke-width:1}.grid{stroke:var(--grid);stroke-width:1}.axis-label,.legend{fill:var(--muted);font-size:11px}.legend-row{display:flex;gap:12px;flex-wrap:wrap;color:var(--muted);font-size:12px;margin-top:6px}.dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:5px}details{margin-top:10px;border-top:1px solid var(--line);padding-top:8px}summary{cursor:pointer;color:var(--accent);font-size:12px}.table-wrap{overflow:auto;max-height:460px;border:1px solid var(--line);border-radius:6px}table{width:100%;border-collapse:collapse;white-space:nowrap;font-size:12px}th,td{text-align:left;padding:7px 10px;border-bottom:1px solid var(--line);vertical-align:top}th{position:sticky;top:0;background:var(--bg);font-weight:600}td{max-width:420px;white-space:pre-wrap;overflow-wrap:anywhere}.null{color:var(--muted);font-style:italic}footer{margin-top:18px;color:var(--muted);font-size:12px}
    @media(max-width:880px){main{width:min(100% - 20px,1440px);padding-top:18px}h1{font-size:21px}.dashboard{grid-template-columns:1fr}.view{grid-column:1!important}.metric{flex-basis:100%}}
    @media print{:root{color-scheme:light;--bg:oklch(98.5% .003 255);--panel:oklch(99.5% .002 255);--text:oklch(24% .025 255);--muted:oklch(48% .02 255);--line:oklch(84% .01 255);--grid:oklch(90% .008 255)}.dashboard{display:block}.view{margin:0 0 12px}.table-wrap{max-height:none;overflow:visible}details{display:block}details>summary{display:none}details>*{display:block!important}main{width:100%;padding:0}}
  </style>
</head>
<body>
  <main>
    <header id="report-header"></header>
    <section id="metric-band" class="metric-band" aria-label="关键指标"></section>
    <section id="dashboard" class="dashboard" aria-label="分析视图"></section>
    <footer id="report-footer"></footer>
  </main>
  <script type="application/json" id="report-data">${data}</script>
  <script>
  (()=>{'use strict';
    const report=JSON.parse(document.getElementById('report-data').textContent||'{}');
    const palette=['#4e79a7','#f28e2b','#59a14f','#e15759','#76b7b2','#edc948','#b07aa1','#9c755f'];
    const ns='http://www.w3.org/2000/svg';
    const el=(tag,className,text)=>{const node=document.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=String(text);return node};
    const svgEl=(tag,attrs={})=>{const node=document.createElementNS(ns,tag);for(const [key,value] of Object.entries(attrs))node.setAttribute(key,String(value));return node};
    const datasetFor=id=>report.datasets.find(item=>item.id===id);
    const indexOf=(dataset,field)=>dataset.columns.indexOf(field);
    const number=value=>value===null||value===undefined||value===''?null:(Number.isFinite(Number(value))?Number(value):null);
    const extent=(values,includeZero=false)=>{const finite=values.filter(Number.isFinite);let min=finite.length?Math.min(...finite):0,max=finite.length?Math.max(...finite):1;if(includeZero){min=Math.min(0,min);max=Math.max(0,max)}if(min===max){min-=1;max+=1}return[min,max]};
    const scale=(value,min,max,start,end)=>start+(value-min)/(max-min)*(end-start);
    const titleFor=view=>view.label||({metric:'指标',line:'趋势',bar:'对比',pie:'构成',scatter:'分布',table:'明细'}[view.kind]||view.id);
    const empty=()=>el('div','empty','暂无数据');
    function tableFor(dataset,columns){const selected=(columns&&columns.length?columns:dataset.columns).map(name=>[name,indexOf(dataset,name)]);const wrap=el('div','table-wrap');const table=el('table');const head=el('thead');const hr=el('tr');selected.forEach(([name])=>hr.append(el('th','',name)));head.append(hr);table.append(head);const body=el('tbody');dataset.rows.forEach(row=>{const tr=el('tr');selected.forEach(([,index])=>{const value=row[index];const td=el('td',value===null?'null':'',value===null?'NULL':value);tr.append(td)});body.append(tr)});table.append(body);wrap.append(table);return wrap}
    function detailsFor(dataset,columns){const details=el('details');details.append(el('summary','','查看原始数据（'+dataset.rows.length+'行）'));details.append(tableFor(dataset,columns));return details}
    function baseSvg(){const svg=svgEl('svg',{viewBox:'0 0 760 300',role:'img',class:'chart','aria-label':'数据图表'});for(let i=0;i<5;i++){const y=30+i*55;svg.append(svgEl('line',{x1:58,y1:y,x2:738,y2:y,class:'grid'}))}svg.append(svgEl('line',{x1:58,y1:250,x2:738,y2:250,class:'axis'}));svg.append(svgEl('line',{x1:58,y1:20,x2:58,y2:250,class:'axis'}));return svg}
    function axisText(svg,text,x,y,anchor='start'){const node=svgEl('text',{x,y,'text-anchor':anchor,class:'axis-label'});node.textContent=String(text);svg.append(node)}
    function legend(card,names){if(names.length<2)return;const row=el('div','legend-row');names.forEach((name,index)=>{const item=el('span');const dot=el('i','dot');dot.style.background=palette[index%palette.length];item.append(dot,document.createTextNode(String(name)));row.append(item)});card.append(row)}
    function lineChart(card,view,dataset){const xIndex=indexOf(dataset,view.x.field);const grouped=new Map();if(view.seriesField){const groupIndex=indexOf(dataset,view.seriesField),yIndex=indexOf(dataset,view.y[0]);dataset.rows.forEach((row,index)=>{const name=row[groupIndex]??'';if(!grouped.has(name))grouped.set(name,[]);grouped.get(name).push({index,x:row[xIndex],y:number(row[yIndex])})})}else view.y.forEach(field=>{const yIndex=indexOf(dataset,field);grouped.set(field,dataset.rows.map((row,index)=>({index,x:row[xIndex],y:number(row[yIndex])}))) });const all=[...grouped.values()].flat().map(point=>point.y).filter(value=>value!==null);if(!all.length){card.append(empty());return}const [min,max]=extent(all);const svg=baseSvg();axisText(svg,max.toLocaleString(),52,27,'end');axisText(svg,min.toLocaleString(),52,250,'end');axisText(svg,view.x.label||view.x.field,398,286,'middle');const count=Math.max(2,dataset.rows.length);[...grouped.entries()].forEach(([name,points],seriesIndex)=>{let segment=[];const flush=()=>{if(segment.length){svg.append(svgEl('polyline',{points:segment.join(' '),fill:'none',stroke:palette[seriesIndex%palette.length],'stroke-width':3,'stroke-linejoin':'round','stroke-linecap':'round'}));segment=[]}};points.forEach(point=>{if(point.y===null){flush();return}const x=scale(point.index,0,count-1,62,734),y=scale(point.y,min,max,246,24);segment.push(x+','+y);svg.append(svgEl('circle',{cx:x,cy:y,r:3,fill:palette[seriesIndex%palette.length]}))});flush()});card.append(svg);legend(card,[...grouped.keys()])}
    function barChart(card,view,dataset){const xIndex=indexOf(dataset,view.x.field);const series=view.seriesField?[view.seriesField]:view.y;const values=[];const entries=[];if(view.seriesField){const groupIndex=indexOf(dataset,view.seriesField),yIndex=indexOf(dataset,view.y[0]);dataset.rows.forEach((row,index)=>{const value=number(row[yIndex]);if(value!==null){values.push(value);entries.push({index,value,name:row[groupIndex]??'',x:row[xIndex]??''})}})}else dataset.rows.forEach((row,index)=>view.y.forEach((field,seriesIndex)=>{const value=number(row[indexOf(dataset,field)]);if(value!==null){values.push(value);entries.push({index,value,name:field,seriesIndex,x:row[xIndex]??''})}}));if(!values.length){card.append(empty());return}const [min,max]=extent(values,true),svg=baseSvg(),zero=scale(0,min,max,246,24),groups=Math.max(1,dataset.rows.length),barWidth=Math.max(2,Math.min(36,620/(groups*Math.max(1,series.length))));svg.append(svgEl('line',{x1:58,y1:zero,x2:738,y2:zero,stroke:'var(--muted)','stroke-width':1.5}));entries.forEach((entry,entryIndex)=>{const seriesIndex=entry.seriesIndex??Math.max(0,series.indexOf(entry.name));const center=scale(entry.index+.5,0,groups,62,734);const offset=(seriesIndex-(series.length-1)/2)*barWidth;const y=scale(entry.value,min,max,246,24);svg.append(svgEl('rect',{x:center+offset-barWidth*.42,y:Math.min(y,zero),width:barWidth*.84,height:Math.max(1,Math.abs(zero-y)),rx:2,fill:palette[(seriesIndex<0?entryIndex:seriesIndex)%palette.length]}))});axisText(svg,max.toLocaleString(),52,27,'end');axisText(svg,min.toLocaleString(),52,250,'end');axisText(svg,view.x.label||view.x.field,398,286,'middle');card.append(svg);legend(card,series)}
    function pieChart(card,view,dataset){const cIndex=indexOf(dataset,view.categoryField),vIndex=indexOf(dataset,view.valueField);const entries=dataset.rows.map(row=>({name:row[cIndex]??'',value:number(row[vIndex])??0})),total=entries.reduce((sum,item)=>sum+item.value,0);if(total<=0){card.append(empty());return}const svg=svgEl('svg',{viewBox:'0 0 760 300',role:'img',class:'chart','aria-label':'构成图'}),cx=235,cy=150,r=105;let angle=-Math.PI/2;entries.forEach((entry,index)=>{const next=angle+entry.value/total*Math.PI*2,x1=cx+Math.cos(angle)*r,y1=cy+Math.sin(angle)*r,x2=cx+Math.cos(next)*r,y2=cy+Math.sin(next)*r,large=next-angle>Math.PI?1:0;const path=svgEl('path',{d:'M '+cx+' '+cy+' L '+x1+' '+y1+' A '+r+' '+r+' 0 '+large+' 1 '+x2+' '+y2+' Z',fill:palette[index%palette.length]});svg.append(path);angle=next});entries.forEach((entry,index)=>{const y=46+index*25;svg.append(svgEl('circle',{cx:490,cy:y-4,r:5,fill:palette[index%palette.length]}));axisText(svg,entry.name+'  '+(entry.value/total*100).toFixed(1)+'%',505,y)});card.append(svg)}
    function scatterChart(card,view,dataset){const xi=indexOf(dataset,view.xField),yi=indexOf(dataset,view.yField),points=dataset.rows.map(row=>[number(row[xi]),number(row[yi])]).filter(point=>point[0]!==null&&point[1]!==null);if(!points.length){card.append(empty());return}const [xmin,xmax]=extent(points.map(point=>point[0])),[ymin,ymax]=extent(points.map(point=>point[1])),svg=baseSvg();points.forEach(point=>svg.append(svgEl('circle',{cx:scale(point[0],xmin,xmax,62,734),cy:scale(point[1],ymin,ymax,246,24),r:4,fill:palette[0],opacity:.82})));axisText(svg,ymax.toLocaleString(),52,27,'end');axisText(svg,ymin.toLocaleString(),52,250,'end');axisText(svg,xmin.toLocaleString(),62,270);axisText(svg,xmax.toLocaleString(),734,270,'end');axisText(svg,view.xField,398,288,'middle');card.append(svg)}
    const header=document.getElementById('report-header');header.append(el('h1','',report.title));if(report.summary)header.append(el('p','',report.summary));header.append(el('p','report-count',report.datasets.length+'个数据集 · '+report.views.length+'个视图'));
    const widths=new Map();let firstChartPlaced=false;report.views.forEach(view=>{if(view.kind==='metric')return;if(view.width){widths.set(view.id,view.width);if(['line','bar','pie','scatter'].includes(view.kind))firstChartPlaced=true;return}const width=view.kind==='table'||!firstChartPlaced?'full':'half';widths.set(view.id,width);if(['line','bar','pie','scatter'].includes(view.kind))firstChartPlaced=true});
    const metricBand=document.getElementById('metric-band');const metrics=report.views.filter(view=>view.kind==='metric');if(metrics.length===0)metricBand.remove();else metrics.forEach(view=>{const dataset=datasetFor(view.datasetId),metric=el('article','metric');metric.append(el('p','metric-label',titleFor(view)));if(!dataset||dataset.rows.length===0)metric.append(el('p','metric-value','—'));else{const value=number(dataset.rows[0][indexOf(dataset,view.field)]);metric.append(el('p','metric-value',value===null?'—':(view.format==='percent'?(value*100).toLocaleString()+'%':value.toLocaleString())))}metricBand.append(metric)});
    const dashboard=document.getElementById('dashboard');report.views.filter(view=>view.kind!=='metric').forEach(view=>{const dataset=datasetFor(view.datasetId),card=el('article','view '+(widths.get(view.id)==='full'?'full ':'')+view.kind);card.append(el('h2','',titleFor(view)));if(!dataset||dataset.rows.length===0)card.append(empty());else if(view.kind==='table')card.append(tableFor(dataset,view.columns));else{if(view.kind==='line')lineChart(card,view,dataset);if(view.kind==='bar')barChart(card,view,dataset);if(view.kind==='pie')pieChart(card,view,dataset);if(view.kind==='scatter')scatterChart(card,view,dataset);card.append(detailsFor(dataset))}dashboard.append(card)});
    document.getElementById('report-footer').textContent='由 DSH Data Agent 生成 · '+${generatedAtText}+' · 离线HTML';
  })();
  </script>
</body>
</html>`
}

export interface WriteAnalysisHtmlOptions {
  cwd: string
  outputName?: string
  generatedAt?: string
}

/** Atomically persist one report and return the report enriched with htmlPath. */
export async function writeAnalysisHtml(
  report: AnalysisReportV1,
  options: WriteAnalysisHtmlOptions,
): Promise<AnalysisReportV1 & { htmlPath: string }> {
  const directory = resolve(options.cwd, ANALYSIS_REPORT_DIRECTORY)
  const relativePath = analysisArtifactRelativePath(report.title, options.outputName)
  const htmlPath = resolve(options.cwd, relativePath)
  const complete = { ...report, htmlPath }
  const basename = analysisFileSegment(options.outputName ?? report.title, '分析报告')
  const temporaryPath = resolve(directory, `.${basename}.${randomUUID()}.tmp`)
  try {
    await mkdir(directory, { recursive: true })
    await writeFile(temporaryPath, renderAnalysisHtml(complete, options.generatedAt), { encoding: 'utf8', flag: 'wx' })
    // A same-directory hard link publishes the fully-written temp inode
    // atomically and fails with EEXIST instead of replacing an earlier report.
    await link(temporaryPath, htmlPath)
    await unlink(temporaryPath).catch(() => undefined)
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined)
    const message = error instanceof Error ? error.message : String(error)
    const exists = (error as NodeJS.ErrnoException | undefined)?.code === 'EEXIST'
    const detail = exists ? '目标文件已存在，请使用更具体的outputName' : message
    throw new Error(`render-analysis: 保存Dashboard HTML失败（${htmlPath}）：${detail}`, { cause: error })
  }
  return complete
}
