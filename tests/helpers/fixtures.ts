import JSZip from "jszip";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { testPng } from "./env";

/** A 3-page PDF: page 1 has one image + text, page 2 text only, page 3 two images. */
export async function makePdf(title = "Project Volt meeting room 4m x 4m") {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const imgs = [await testPng("#E8E1D6", "#6F573E"), await testPng("#4A4E52", "#C87533"), await testPng("#DCE3D5", "#4E6B4A")];
  const p1 = pdf.addPage([800, 600]);
  p1.drawText(title, { x: 40, y: 560, size: 18, font });
  p1.drawImage(await pdf.embedPng(imgs[0]), { x: 40, y: 100, width: 400, height: 300 });
  const p2 = pdf.addPage([800, 600]);
  p2.drawText("Material palette notes", { x: 40, y: 560, size: 18, font });
  const p3 = pdf.addPage([800, 600]);
  p3.drawText("Boardroom and cabin", { x: 40, y: 560, size: 18, font });
  p3.drawImage(await pdf.embedPng(imgs[1]), { x: 40, y: 100, width: 300, height: 220 });
  p3.drawImage(await pdf.embedPng(imgs[2]), { x: 400, y: 100, width: 300, height: 220 });
  return Buffer.from(await pdf.save());
}

/** Minimal valid PPTX: 2 slides in presentation order, slide 2 embeds two images (one EMF to be skipped). */
export async function makePptx() {
  const zip = new JSZip();
  const ns = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
  zip.file("[Content_Types].xml", '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>');
  zip.file("ppt/presentation.xml", `<?xml version="1.0"?><p:presentation ${ns}><p:sldIdLst><p:sldId id="256" r:id="rId2"/><p:sldId id="257" r:id="rId3"/></p:sldIdLst></p:presentation>`);
  zip.file("ppt/_rels/presentation.xml.rels", `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>`);
  // Presentation order is slide2.xml first, then slide1.xml.
  zip.file("ppt/slides/slide2.xml", `<?xml version="1.0"?><p:sld ${ns}><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Reception &amp; lobby</a:t></a:r></a:p></p:txBody></p:sp><p:pic><p:blipFill><a:blip r:embed="rId1"/></p:blipFill></p:pic><p:pic><p:blipFill><a:blip r:embed="rId9"/></p:blipFill></p:pic></p:spTree></p:cSld></p:sld>`);
  zip.file("ppt/slides/_rels/slide2.xml.rels", `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/><Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/logo.png"/></Relationships>`);
  zip.file("ppt/slides/slide1.xml", `<?xml version="1.0"?><p:sld ${ns}><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Cabin concept</a:t></a:r></a:p></p:txBody></p:sp><p:pic><p:blipFill><a:blip r:embed="rId1"/></p:blipFill></p:pic><p:pic><p:blipFill><a:blip r:embed="rId2"/></p:blipFill></p:pic></p:spTree></p:cSld></p:sld>`);
  zip.file("ppt/slides/_rels/slide1.xml.rels", `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image2.png"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image3.emf"/></Relationships>`);
  zip.file("ppt/media/image1.png", await testPng("#F1ECE4", "#8C6E4E"));
  zip.file("ppt/media/image2.png", await testPng("#DCE3D5", "#4E6B4A", 900, 630));
  zip.file("ppt/media/logo.png", await testPng("#FFFFFF", "#000000", 200, 120));
  zip.file("ppt/media/image3.emf", Buffer.from("not really an emf"));
  return zip.generateAsync({ type: "nodebuffer" });
}
