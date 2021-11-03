import * as glm from "gl-matrix"
import { Network } from "./Network.js"
import * as glUtils from "../utils/webglutils.js"
import * as xnet from "../utils/xnet.js"
import { select as d3Select } from "d3-selection";
import { zoom as d3Zoom, zoomTransform as d3ZoomTransform, zoomIdentity as d3ZoomIdentity } from "d3-zoom";
import { drag as d3Drag } from "d3-drag";
import { default as createGraph } from "ngraph.graph"
import { default as createLayout } from "ngraph.forcelayout"
import { forceSimulation, forceManyBody, forceLink, forceCenter } from "d3-force-3d";
import {default as Pica} from "pica";
import {workerURL as d3force3dLayoutURL} from "../layouts/d3force3dLayoutWorker.js"


let isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);


// You can associate arbitrary objects with node:


// //dictionary
// elementID,
// nodes = {},
// edges = [],
// // use settings
// // displayOptions inside settings
// onNodeClick = null,
// onEdgeClick = null,
// display = [],
export class Helios {
	constructor({
		elementID,
		nodes = {},
		edges = [],
		// use settings
		// displayOptions inside settings
		// onNodeHover = null,
		// onEdgeHover = null,
		// onDraw  (Maybe)
		use2D = false,
		display = [],
	}) {
		this.element = document.getElementById(elementID);
		this.element.innerHTML = '';
		this.canvasElement = document.createElement("canvas");
		this.element.appendChild(this.canvasElement);
		this.network = new Network(nodes, edges);
		this.display = display;

		this.rotationMatrix = glm.mat4.create();
		this.translatePosition = glm.vec3.create();
		this.mouseDown = false;
		this.lastMouseX = null;
		this.lastMouseY = null;
		this.redrawingFromMouseWheelEvent = false;
		this.fastEdges = false;
		this.animate = false;
		this.cameraDistance = 450;
		this._zoomFactor = 1;
		this.rotateLinearX = 0;
		this.rotateLinearY = 0;
		this.panX = 0;
		this.panY = 0;
		this.saveResolutionRatio = 1.0;
		this.pickingResolutionRatio = 0.25;
		this._edgesIntensity = 1.0;
		this._use2D = use2D;
		this.useAdditiveBlending = false;

		if (this._use2D) {
			for (let vertexIndex = 0; vertexIndex < this.network.positions.length; vertexIndex++) {
				this.network.positions[vertexIndex * 3 + 2] = 0;
			}
		}



		glm.mat4.identity(this.rotationMatrix);
		var translatePosition = [0, 0, 0];
		this.gl = glUtils.createWebGLContext(this.canvasElement, {
			antialias: true,
			powerPreference: "high-performance",
			desynchronized: true
		});

		console.log(this.gl);
		this.initialize();
		window.onresize = event => {
			this.willResizeEvent(event);
		};

		this.onNodeClickCallback = null;
		this.onNodeHoverStartCallback = null;
		this.onNodeHoverMoveCallback = null;
		this.onNodeHoverEndCallback = null;
		// this.onEdgeClickCallback = null;
		this.onZoomCallback = null;
		this.onRotationCallback = null;
		this.onResizeCallback = null;
		this.onLayoutStartCallback = null;
		this.onLayoutFinishCallback = null;
		this.onDrawCallback = null;
		this._backgroundColor = [0.5, 0.5, 0.5, 1.0];
		this.onReadyCallback = null;
		this.isReady=false;
	}

	// d3-like function Set/Get
	//zoom()
	//rotate()
	//pan()
	//highlightNodes()
	//centerNode()





	async initialize() {
		await this._setupShaders();
		await this._buildGeometry();
		await this._buildPickingBuffers();
		await this._buildEdgesGeometry();
		await this.willResizeEvent(0);

		await this._setupCamera();
		await this._setupEvents();
		await this._setupLayout();

		await this.redraw();
		this.onReadyCallback?.(this);
		this.onReadyCallback = null;
		this.isReady = true;
	}

	_setupLayout() {

		// this.layoutWorker = new Worker(new URL('../layouts/ngraphLayoutWorker.js', import.meta.url));
		// this.layoutWorker = new Worker(new URL('../layouts/d3force3dLayoutWorker.js', import.meta.url));
		this.layoutWorker = new Worker(d3force3dLayoutURL);
		
		this.newPositions = this.network.positions.slice(0);
		this.positionInterpolator = null;
		this.layoutWorker.onmessage = (msg) => {
			if (msg.data.type == "layoutStep") {
				this.newPositions = msg.data.positions;
				// let newPositions = msg.data.positions;
				// for (let index = 0; index < this.network.positions.length; index++) {
				// 	this.network.positions[index] = newPositions[index];
				// };
				// requestAnimationFrame(()=>{	
				// 	this._updateGeometry();
				// 	this._updateEdgesGeometry();
				// 	this.redraw();
				// });
				// console.log("receiving positions...");
				if (this.positionInterpolator == null) {
					let maxDisplacement = 0;
					for (let index = 0; index < this.network.positions.length; index++) {
						let displacement = this.newPositions[index] - this.network.positions[index];
						maxDisplacement = Math.max(Math.abs(displacement), maxDisplacement);
					};
					if (maxDisplacement > 1) {
						// console.log("Interpolator Started...");
						this.onLayoutStartCallback?.();
						this.positionInterpolator = setInterval(() => {
							let maxDisplacement = 0;
							for (let index = 0; index < this.network.positions.length; index++) {
								let displacement = this.newPositions[index] - this.network.positions[index];
								this.network.positions[index] += 0.025 * (displacement);
								maxDisplacement = Math.max(Math.abs(displacement), maxDisplacement);
							};
							this._updateGeometry();
							this._updateEdgesGeometry();
							requestAnimationFrame(() => {
								this.redraw();
							});
							if (maxDisplacement < 1) {
								// console.log("Interpolator Stopped...");
								this.onLayoutFinishCallback?.();
								clearInterval(this.positionInterpolator);
								this.positionInterpolator = null;
							}
						}, 1000 / 60);
					}
				}
			} else {
				console.log("Received message", msg);
			}
		}
		// this.layoutWorker.postMessage({ type: "import", location: import.meta.url });
		this.layoutWorker.postMessage({ type: "init", network: this.network, use2D: this._use2D });
		this.layoutRunning = true;
		document.addEventListener('keyup', event => {
			if (event.code === 'Space') {
				if(this.layoutRunning){
					this.stopLayout();
				}else{
					this.resumeLayout();
				}
			}
		})
	}

	stopLayout(){
		this.layoutWorker.postMessage({ type: "stop"});
		this.layoutRunning=false;
	}

	resumeLayout(){
		this.layoutWorker.postMessage({ type: "restart" });
		this.layoutRunning=true;
	}
	
	_setupEvents() {
		this.lastMouseX = -1;
		this.lastMouseY = -1;

		this.currentHoverIndex = -1;

		this.canvasElement.onclick = e => {
			const rect = this.canvasElement.getBoundingClientRect();

			this.lastMouseX = e.clientX;
			this.lastMouseY = e.clientY;
			const nodeIndex = this.pickPoint(this.lastMouseX - rect.left, this.lastMouseY - rect.top);
			if (nodeIndex >= 0) {
				this.onNodeClickCallback?.(this.network.index2Node[nodeIndex], e);
			}
		};

		this.canvasElement.addEventListener('mousemove', (event) => {
			this.lastMouseX = event.clientX;
			this.lastMouseY = event.clientY;
			this.triggerHoverEvents(event);
		});

		this.canvasElement.addEventListener('mouseleave', (e) => {
			if (this.currentHoverIndex >= 0) {
				this.onNodeHoverEndCallback?.(this.network.index2Node[this.currentHoverIndex], e);
				this.currentHoverIndex = -1;
				this.lastMouseX = -1;
				this.lastMouseY = -1;
			}
			
		});
		document.body.addEventListener('mouseout', (e) => {
				if (!e.relatedTarget && !e.toElement) {
					if (this.currentHoverIndex >= 0) {
						this.onNodeHoverEndCallback?.(this.network.index2Node[this.currentHoverIndex], e);
						this.currentHoverIndex = -1;
						this.lastMouseX = -1;
						this.lastMouseY = -1;
					}
				}
		});
	}

	async _downloadImageData(imagedata, filename, supersampleFactor,fileFormat) {
		// let canvas = document.getElementById('SUPERCANVAS');
		let pica = new Pica({
			// features:["all"],
		})
		let canvas = document.createElement('canvas');
		let canvasFullSize = document.createElement('canvas');
		let ctx = canvas.getContext('2d');
		let ctxFullSize = canvasFullSize.getContext('2d');
		canvasFullSize.width = imagedata.width;
		canvasFullSize.height = imagedata.height;
		canvas.width = imagedata.width/supersampleFactor;
		canvas.height = imagedata.height/supersampleFactor;
		ctx.imageSmoothingEnabled = true;
		ctxFullSize.imageSmoothingEnabled = true;
		if(typeof ctx.imageSmoothingQuality !== 'undefined'){
			ctx.imageSmoothingQuality = 'high';
		}
		if(typeof ctxFullSize.imageSmoothingQuality !== 'undefined'){
			ctxFullSize.imageSmoothingQuality = 'high';
		}

		// let dpr = window.devicePixelRatio || 1;
		// canvas.style.width =  canvas.width/dpr/10 + "px";
		// canvas.style.height = canvas.height/dpr/10 + "px";


		ctxFullSize.putImageData(imagedata, 0, 0);
		
		await pica.resize(canvasFullSize,canvas,{
			alpha:true,
		});

		// ctxFullSize.drawImage(canvasFullSize, 0, 0,canvasFullSize.width*0.5,canvasFullSize.height*0.5,0,0,
		// 	imagedata.width/supersampleFactor,
		// 	imagedata.height/supersampleFactor);
		// ctx.drawImage(canvasFullSize, 0, 0,canvasFullSize.width,canvasFullSize.height,0,0,
		// 	imagedata.width/supersampleFactor,
		// 	imagedata.height/supersampleFactor);
		
		
		// let image = new Image();
		// let imageSRC = canvas.toDataURL()
		// image.src = imageSRC;
		let downloadLink = document.createElement('a');
		// console.log(["CANVAS",imageSRC]);

					
		if(isSafari){
			// BUG in Safari
			console.log("Fixing Safari bug...");
			canvas.toDataURL();
		}

		downloadLink.setAttribute('download', filename);
		let blob = await pica.toBlob(canvas,"image/png");
		if(blob){
			if(filename.endsWith("svg")){
				let svgText = `
				<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"
				width="${canvas.width}" height="${canvas.width}"
				>
				<image
						width="${canvas.width}" height="${canvas.width}"
						xlink:href="${blob}"
						/>
				</svg>`
				downloadLink.setAttribute('download', filename);
				let blobSVG = new Blob([svgText], {type: 'image/svg+xml'});
				let url = URL.createObjectURL(blobSVG);
				downloadLink.setAttribute('href', url);
				downloadLink.click();
			}else{
				let url = URL.createObjectURL(blob);
				downloadLink.setAttribute('href', url);
				downloadLink.click();
			}
		}else{
			window.alert(`An error occured while trying to download the image. Please try again. (Error: blob is null.)`);
			// console.log("BLOB IS NULL");
		}

		if(filename.endsWith("svg")){
			let svgText = `
			<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"
			width="${canvas.width}" height="${canvas.width}"
			>
			<image
					width="${canvas.width}" height="${canvas.width}"
					xlink:href="${canvas.toDataURL()}"
					/>
			</svg>`
			downloadLink.setAttribute('download', filename);
			let blob = new Blob([svgText], {type: 'image/svg+xml'});
			let url = URL.createObjectURL(blob);
			downloadLink.setAttribute('href', url);
			downloadLink.click();
		}else if (false){
			downloadLink.setAttribute('download', filename);
			downloadLink.setAttribute('href', canvas.toDataURL("image/png").replace("image/png", "image/octet-stream"));
			downloadLink.click();
		}else{

			// canvas.toBlob(function(blob) {
			// 	console.log(["CANVAS",blob]);
			// 	let trials = 3;
			// 	let success = false;
			// 	let lastError = null;
			// 	while(trials>0 && !success){
			// 		// FIXME: Safari BUG
			// 		try {
			// 			let url = URL.createObjectURL(blob);
			// 			downloadLink.setAttribute('href', url);
			// 			downloadLink.click();
			// 			success=true;
			// 		} catch (error) {
			// 			lastError = error;
			// 		}
			// 		trials--;
			// 	}
			// 	if(!success){
			// 		window.alert(`An error occured while trying to download the image. Please try again. (Error: ${lastError})`)
			// 	}
			// });
		}
	}

	framebufferImage(framebuffer) { 
		const fbWidth = framebuffer.size.width;
		const fbHeight = framebuffer.size.height;
		const data = new Uint8ClampedArray(4*fbWidth*fbHeight);
		let gl = this.gl;
		gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
		gl.readPixels(
			0,            // x
			0,            // y
			fbWidth,                 // width
			fbHeight,                 // height
			gl.RGBA,           // format
			gl.UNSIGNED_BYTE,  // type
			data);             // typed array to hold result

		return new ImageData(data, fbWidth, fbHeight);
	}

	exportFigure(filename,{
			scale=1.0,
			supersampleFactor=4.0,
			width=null,
			height=null,
			backgroundColor = null,
		}) {
		if(typeof(scale)==='undefined'){
			scale=1.0;
		}
		if(typeof(supersampleFactor)==='undefined'){
			supersampleFactor=2.0;
		}
		let framebuffer = this.createOffscreenFramebuffer();
		if(width==null && height==null){
			width = this.canvasElement.width;
			height = this.canvasElement.height;
		}else if(width==null){
			width = Math.round(height * this.canvasElement.width/this.canvasElement.height);
		}else if(height==null){
			height = Math.round(width * this.canvasElement.height/this.canvasElement.width);
		}
		if(backgroundColor==null){
			backgroundColor = this.backgroundColor;
		}
		framebuffer.setSize(width*scale*supersampleFactor, height*scale*supersampleFactor);
		framebuffer.backgroundColor = backgroundColor;
		this._redrawAll(framebuffer);
		let image = this.framebufferImage(framebuffer);
		this._downloadImageData(image,filename,supersampleFactor);
		
		framebuffer.discard();
	}

	triggerHoverEvents(event) {
		if(this.lastMouseX==-1 || this.lastMouseY==-1){
			return;
		}
		const rect = this.canvasElement.getBoundingClientRect();
		const nodeID = this.pickPoint(this.lastMouseX - rect.left, this.lastMouseY - rect.top);
		if (nodeID >= 0 && this.currentHoverIndex == -1) {
			this.currentHoverIndex = nodeID;
			this.onNodeHoverStartCallback?.(this.network.index2Node[nodeID], event);
		} else if (nodeID >= 0 && this.currentHoverIndex == nodeID) {
			// console.log("mouse: ",this.lastMouseX,this.lastMouseY)
			this.onNodeHoverMoveCallback?.(this.network.index2Node[nodeID], event);
		} else if (nodeID >= 0 && this.currentHoverIndex != nodeID) {
			this.onNodeHoverEndCallback?.(this.network.index2Node[this.currentHoverIndex], event);
			this.currentHoverIndex = nodeID;
			this.onNodeHoverStartCallback?.(this.network.index2Node[nodeID], event);
		} else if (nodeID == -1 && this.currentHoverIndex != nodeID) {
			this.onNodeHoverEndCallback?.(this.network.index2Node[this.currentHoverIndex], event);
			this.currentHoverIndex = -1;
		}
	}
	async _setupShaders() {
		let edgesShaderVertex = await glUtils.getShader(this.gl, "edges-vertex");
		let edgesShaderFragment = await glUtils.getShader(this.gl, "edges-fragment");
		// let edgesShaderVertex = await glUtils.getShaderFromURL(this.gl, new URL('../shaders/edges.vsh', import.meta.url), this.gl.VERTEX_SHADER)
		// let edgesShaderFragment = await glUtils.getShaderFromURL(this.gl, new URL('../shaders/edges.fsh', import.meta.url), this.gl.FRAGMENT_SHADER) //gl.FRAGMENT_SHADER or 



		this.edgesShaderProgram = new glUtils.ShaderProgram(
			edgesShaderVertex,
			edgesShaderFragment,
			["projectionViewMatrix", "nearFar", "linesIntensity"],
			["vertex", "color"],
			this.gl);

		//Initializing vertices shaders
		let verticesShaderVertex = await glUtils.getShader(this.gl, "vertices-vertex");
		let verticesShaderFragment = await glUtils.getShader(this.gl, "vertices-fragment");
		let pickingShaderFragment = await glUtils.getShader(this.gl, "vertices-fragment-picking");

		// let verticesShaderVertex = await glUtils.getShaderFromURL(this.gl, new URL('../shaders/vertices.vsh', import.meta.url), this.gl.VERTEX_SHADER)
		// let verticesShaderFragment = await glUtils.getShaderFromURL(this.gl, new URL('../shaders/vertices.fsh', import.meta.url), this.gl.FRAGMENT_SHADER) //gl.FRAGMENT_SHADER or 
		// let pickingShaderFragment = await glUtils.getShaderFromURL(this.gl, new URL('../shaders/verticesPicking.fsh', import.meta.url), this.gl.FRAGMENT_SHADER) //gl.FRAGMENT_SHADER or 

		this.verticesShaderProgram = new glUtils.ShaderProgram(verticesShaderVertex, verticesShaderFragment,
			["viewMatrix", "projectionMatrix", "normalMatrix"],
			["vertex", "position", "color", "intensity", "size","outlineWidth","outlineColor", "encodedIndex"], this.gl);

		this.verticesPickingShaderProgram = new glUtils.ShaderProgram(verticesShaderVertex, pickingShaderFragment,
			["viewMatrix", "projectionMatrix", "normalMatrix"],
			["vertex", "position", "color", "intensity", "size","outlineWidth","outlineColor", "encodedIndex"], this.gl);

	}

	async _buildGeometry() {
		let gl = this.gl;
		let sphereQuality = 15;
		// this.nodesGeometry = glUtils.makeSphere(gl, 1.0, sphereQuality, sphereQuality);
		this.nodesGeometry = glUtils.makePlane(gl, false, false);
		// //vertexShape = makeBox(gl);



		this.nodesPositionBuffer = gl.createBuffer();
		this.nodesColorBuffer = gl.createBuffer();
		this.nodesSizeBuffer = gl.createBuffer();
		this.nodesIntensityBuffer = gl.createBuffer();
		this.nodesOutlineWidthBuffer = gl.createBuffer();
		this.nodesOutlineColorBuffer = gl.createBuffer();
		this.nodesIndexBuffer = gl.createBuffer();

		//encodedIndex
		this.nodesIndexArray = new Float32Array(this.network.index2Node.length * 4);
		for (let ID = 0; ID < this.network.index2Node.length; ID++) {
			this.nodesIndexArray[4 * ID] = (((ID + 1) >> 0) & 0xFF) / 0xFF;
			this.nodesIndexArray[4 * ID + 1] = (((ID + 1) >> 8) & 0xFF) / 0xFF;
			this.nodesIndexArray[4 * ID + 2] = (((ID + 1) >> 16) & 0xFF) / 0xFF;
			this.nodesIndexArray[4 * ID + 3] = (((ID + 1) >> 24) & 0xFF) / 0xFF;
		}

		gl.bindBuffer(gl.ARRAY_BUFFER, this.nodesIndexBuffer);
		gl.bufferData(gl.ARRAY_BUFFER, this.nodesIndexArray, gl.STATIC_DRAW);
		console.log(this.nodesIndexArray)

		await this._updateGeometry();
	}

	async _buildPickingBuffers() {
		let gl = this.gl;
		this.pickingFramebuffer = this.createOffscreenFramebuffer();
	}

	createOffscreenFramebuffer() {
		let gl = this.gl;
		let framebuffer = gl.createFramebuffer();
		framebuffer.texture = gl.createTexture();
		gl.bindTexture(gl.TEXTURE_2D, framebuffer.texture);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

		framebuffer.depthBuffer = gl.createRenderbuffer();
		gl.bindRenderbuffer(gl.RENDERBUFFER, framebuffer.depthBuffer);

		// Create and bind the framebuffer
		gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
		framebuffer.size = {
			width: 0,
			height: 0,
		};

		framebuffer.setSize = (width, height) => {
			gl.bindTexture(gl.TEXTURE_2D, framebuffer.texture);
			// define size and format of level 0
			const level = 0;
			const internalFormat = gl.RGBA;
			const border = 0;
			const format = gl.RGBA;
			const type = gl.UNSIGNED_BYTE;
			const data = null;
			const fbWidth = width;
			const fbHeight = height;
			gl.texImage2D(gl.TEXTURE_2D, level, internalFormat,
				fbWidth, fbHeight, border, format, type, data);
			gl.bindRenderbuffer(gl.RENDERBUFFER, framebuffer.depthBuffer);
			gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, fbWidth, fbHeight);
			framebuffer.size.width = width;
			framebuffer.size.height = height;
		};

		framebuffer.discard = () =>{
			gl.deleteRenderbuffer(framebuffer.depthBuffer);
			gl.deleteTexture(framebuffer.texture);
			gl.deleteFramebuffer(framebuffer);
		}
		// attach the texture as the first color attachment
		const attachmentPoint = gl.COLOR_ATTACHMENT0;
		const level = 0;
		gl.framebufferTexture2D(gl.FRAMEBUFFER, attachmentPoint, gl.TEXTURE_2D, framebuffer.texture, level);

		// make a depth buffer and the same size as the targetTexture
		gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, framebuffer.depthBuffer);
		return framebuffer;
	}


	async _updateGeometry() {
		let gl = this.gl;

		let positions = this.network.positions;

		gl.bindBuffer(gl.ARRAY_BUFFER, this.nodesPositionBuffer);
		gl.bufferData(gl.ARRAY_BUFFER, positions, gl.DYNAMIC_DRAW);

		let colors = this.network.colors;
		gl.bindBuffer(gl.ARRAY_BUFFER, this.nodesColorBuffer);
		gl.bufferData(gl.ARRAY_BUFFER, colors, gl.STATIC_DRAW);

		let sizes = this.network.sizes;
		gl.bindBuffer(gl.ARRAY_BUFFER, this.nodesSizeBuffer);
		gl.bufferData(gl.ARRAY_BUFFER, sizes, gl.STATIC_DRAW);

		let intensities = this.network.intensities;
		gl.bindBuffer(gl.ARRAY_BUFFER, this.nodesIntensityBuffer);
		gl.bufferData(gl.ARRAY_BUFFER, intensities, gl.STATIC_DRAW);

		let outlineWidths = this.network.outlineWidths;
		gl.bindBuffer(gl.ARRAY_BUFFER, this.nodesOutlineWidthBuffer);
		gl.bufferData(gl.ARRAY_BUFFER, outlineWidths, gl.STATIC_DRAW);
		
		let outlineColors = this.network.outlineColors;
		gl.bindBuffer(gl.ARRAY_BUFFER, this.nodesOutlineColorBuffer);
		gl.bufferData(gl.ARRAY_BUFFER, outlineColors, gl.STATIC_DRAW);


		// //Depth test is essential for the desired effects

		// gl.disable(gl.CULL_FACE);
		// gl.frontFace(gl.CCW);

	}

	async _buildEdgesGeometry() {
		let gl = this.gl;
		let edges = this.network.indexedEdges;
		let positions = this.network.positions;
		let colors = this.network.colors;

		let newGeometry = new Object();
		let indicesArray;

		//FIXME: If num of vertices > 65k, we need to store the geometry in two different indices objects
		if (positions.length < 64000) {
			indicesArray = new Uint16Array(edges);
			newGeometry.indexType = gl.UNSIGNED_SHORT;
		} else {
			var uints_for_indices = gl.getExtension("OES_element_index_uint");
			if (uints_for_indices == null) {
				indicesArray = new Uint16Array(edges);
				newGeometry.indexType = gl.UNSIGNED_SHORT;
			} else {
				indicesArray = new Uint32Array(edges);
				newGeometry.indexType = gl.UNSIGNED_INT;
			}
		}

		// create the lines buffer 2 vertices per geometry.
		newGeometry.vertexObject = gl.createBuffer();
		newGeometry.colorObject = gl.createBuffer();
		newGeometry.numIndices = indicesArray.length;
		newGeometry.indexObject = gl.createBuffer();

		this.edgesGeometry = newGeometry;
		this.indicesArray = indicesArray;
		await this._updateEdgesGeometry()
	}

	async _updateEdgesGeometry() {
		let gl = this.gl;
		let edges = this.network.indexedEdges;
		let positions = this.network.positions;
		let colors = this.network.colors;

		gl.bindBuffer(gl.ARRAY_BUFFER, this.edgesGeometry.vertexObject);
		gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);
		gl.bindBuffer(gl.ARRAY_BUFFER, this.edgesGeometry.colorObject);
		gl.bufferData(gl.ARRAY_BUFFER, colors, gl.STATIC_DRAW);
		gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.edgesGeometry.indexObject);
		gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, this.indicesArray, gl.STREAM_DRAW);

	}

	async resizeGL(newWidth, newHeight) {
		this.pickingFramebuffer.setSize(newWidth*this.pickingResolutionRatio, newHeight*this.pickingResolutionRatio);
		window.requestAnimationFrame(() => this.redraw());
	}



	async _setupCamera() {
		// this.canvasElement.onmousedown = event=>this.handleMouseDown(event);
		// document.onmouseup = event=>this.handleMouseUp(event);
		// document.onmousemove = event=>this.handleMouseMove(event);
		// document.onclick = void(0);
		
		
		this.zoom = d3Zoom().on("zoom", event => {
			this._zoomFactor = event.transform.k;
			this.triggerHoverEvents(event);
			// check if prevX is undefined
			if(this.prevK=== undefined){
				this.prevK = event.transform.k;
			}
			let dx = 0;
			let dy = 0;
			if(this.prevK == event.transform.k){
				if(this.prevX=== undefined){
					dx = event.transform.x;
					dy = event.transform.y;
				}else{
					dx = event.transform.x - this.prevX*this._zoomFactor;
					dy = event.transform.y - this.prevY*this._zoomFactor;
				}
			}else{
			}
			

			this.prevX = event.transform.x/this._zoomFactor;
			this.prevY = event.transform.y/this._zoomFactor;
			this.prevK = event.transform.k;
			
		// 	if (!this.positionInterpolator) {
		// 		this.update();
		// 		this.render();
		// 	}
		// 	// event => event.preventDefault();
		// })
		// // this.drag = d3Drag().on("drag", event => {
		// // 	let dx = event.dx;
		// // 	let dy = event.dy;
		
		// this.zoom2 = d3Zoom().scaleExtent([1.0,1.0]).on("zoom", event => {
		// 	console.log("ZOOM 2")
		// 	// let dx = event.dx;
		// 	// let dy = event.dy;
			// let dx = 0;
			// let dy = 0;
			// if(this.prevX=== undefined){
			// 	dx = event.transform.x;
			// 	dy = event.transform.y;
			// }else{
			// 	dx = event.transform.x - this.prevX;
			// 	dy = event.transform.y - this.prevY;
			// }
			
			let newRotationMatrix = glm.mat4.create();
			// console.log(event.sourceEvent.shiftKey)
			if (this._use2D || event.sourceEvent?.shiftKey) {
				let perspectiveFactor = this.cameraDistance * this._zoomFactor;
				let aspectRatio = this.canvasElement.width / this.canvasElement.height;
				this.panX = this.panX + dx / perspectiveFactor*400;///400;
				this.panY = this.panY - dy / perspectiveFactor*400;///400;
			} else {//pan
				glm.mat4.identity(newRotationMatrix);
				glm.mat4.rotate(newRotationMatrix, newRotationMatrix, glUtils.degToRad( dx/ 2), [0, 1, 0]);
				glm.mat4.rotate(newRotationMatrix, newRotationMatrix, glUtils.degToRad(dy / 2), [1, 0, 0]);

				glm.mat4.multiply(this.rotationMatrix, newRotationMatrix, this.rotationMatrix);
			}
			if (!this.positionInterpolator) {
				this.update();
				this.render();
			}
			// this.triggerHoverEvents(event);
			event => event.preventDefault();
		})
		
		d3Select(this.canvasElement)//
			// .call(d3ZoomTransform, d3ZoomIdentity.translate(0, 0).scale(this.cameraDistance))
			// .call(this.drag)
			.call(this.zoom)
			// .on("mousedown.drag", null)
			// .on("touchstart.drag", null)
			// .on("touchmove.drag", null)
			// .on("touchend.drag", null)
			.on("dblclick.zoom", null);


		// this.zoomFactor(0.05)
		// this.zoomFactor(1.0,500);
	}
	
	zoomFactor(zoomFactor,duration){
		if(zoomFactor !== undefined){
			if(duration === undefined){
				d3Select(this.canvasElement).call(this.zoom.transform, d3ZoomIdentity.translate(0, 0).scale(zoomFactor))
			}else{
				d3Select(this.canvasElement).transition().duration(duration).call(this.zoom.transform, d3ZoomIdentity.translate(0, 0).scale(zoomFactor))
			}
			return this;
		}else{
			return this._zoomFactor;
		}
	}

	willResizeEvent(event) {
		//requestAnimFrame(function(){
		let dpr = window.devicePixelRatio || 1;
		if(dpr<2.0){
			dpr=2.0;
		}
		this.canvasElement.style.width = this.element.clientWidth + "px";
		this.canvasElement.style.height = this.element.clientHeight + "px";
		this.canvasElement.width = dpr * this.element.clientWidth;
		this.canvasElement.height = dpr * this.element.clientHeight;
		this.resizeGL(this.canvasElement.width, this.canvasElement.height);
		this.onResizeCallback?.(event);
		//});
	}


	redraw() {
		this._redrawAll(null,false); // Normal
		this._redrawAll(this.pickingFramebuffer,true); // Picking
		this.onDrawCallback?.();
		this.triggerHoverEvents(null);
	}

	update() {
		if (!this.positionInterpolator) {
			this._updateGeometry();
			this._updateEdgesGeometry();
		}
	}
	render() {
		if (!this.positionInterpolator) {
			window.requestAnimationFrame(() => this.redraw());
		}
	}


	//destination null = normal

	_redrawPrepare(destination,isPicking, viewport) {
		let gl = this.gl;

		const fbWidth = destination?.size.width || this.canvasElement.width;
		const fbHeight = destination?.size.height || this.canvasElement.height;
		if (destination==null) {
			gl.bindFramebuffer(gl.FRAMEBUFFER, null);
			gl.clearColor(...this._backgroundColor);
		} else if (isPicking){
			gl.bindFramebuffer(gl.FRAMEBUFFER, destination);
			gl.clearColor(0.0, 0.0, 0.0, 0.0);
		} else {
			gl.bindFramebuffer(gl.FRAMEBUFFER, destination);
			if(typeof destination.backgroundColor === "undefined"){
				gl.clearColor(...this._backgroundColor);
			}else{
				gl.clearColor(...destination.backgroundColor);
			}
		}

		if(typeof viewport=== "undefined"){
			gl.viewport(0, 0, fbWidth, fbHeight);
		}else{
			gl.viewport(...viewport);
		}

		gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
		gl.depthFunc(gl.LEQUAL);

		this.projectionMatrix = glm.mat4.create();
		this.viewMatrix = glm.mat4.create();

		glm.mat4.perspective(this.projectionMatrix, Math.PI * 2 / 360 * 70, fbWidth / fbHeight, 1.0, 10000.0);
		glm.mat4.identity(this.viewMatrix);
		glm.mat4.translate(this.viewMatrix, this.viewMatrix, [this.panX, this.panY, -this.cameraDistance / this._zoomFactor]);


		glm.mat4.multiply(this.viewMatrix, this.viewMatrix, this.rotationMatrix);
		// glm.mat4.scale(this.viewMatrix, this.viewMatrix, [this._zoomFactor, this._zoomFactor, this._zoomFactor]);
		glm.mat4.translate(this.viewMatrix, this.viewMatrix, this.translatePosition);


	}
	
	_redrawNodes(destination,isPicking) {
		let gl = this.gl;
		let ext = gl.getExtension("ANGLE_instanced_arrays");


		let currentShaderProgram;
		if (!isPicking) {
			// console.log(this.verticesShaderProgram);
			gl.enable(gl.BLEND);
				// if(this.useAdditiveBLending){
			// gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
			// 	}else{
			gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
			// gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA,
			// 	gl.ZERO, gl.ONE);
			// 	}
			currentShaderProgram = this.verticesShaderProgram;
		} else {
			gl.disable(gl.BLEND);
			// console.log(this.verticesShaderProgram);
			currentShaderProgram = this.verticesPickingShaderProgram;
		}

		currentShaderProgram.use(gl);
		currentShaderProgram.attributes.enable("vertex");
		// currentShaderProgram.attributes.enable("normal");
		currentShaderProgram.attributes.enable("position");
		currentShaderProgram.attributes.enable("size");
		currentShaderProgram.attributes.enable("intensity");
		currentShaderProgram.attributes.enable("outlineWidth");
		currentShaderProgram.attributes.enable("outlineColor");
		currentShaderProgram.attributes.enable("encodedIndex");


		gl.bindBuffer(gl.ARRAY_BUFFER, this.nodesGeometry.vertexObject);
		gl.vertexAttribPointer(currentShaderProgram.attributes.vertex, 3, gl.FLOAT, false, 0, 0);
		ext.vertexAttribDivisorANGLE(currentShaderProgram.attributes.vertex, 0);

		// gl.bindBuffer(gl.ARRAY_BUFFER, this.nodesGeometry.normalObject);
		// gl.vertexAttribPointer(currentShaderProgram.attributes.normal, 3, gl.FLOAT, false, 0, 0);
		// ext.vertexAttribDivisorANGLE(currentShaderProgram.attributes.normal, 0); 

		if (this.nodesGeometry.indexObject) {
			gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.nodesGeometry.indexObject);
		}

		gl.uniformMatrix4fv(currentShaderProgram.uniforms.projectionMatrix, false, this.projectionMatrix);
		gl.uniformMatrix4fv(currentShaderProgram.uniforms.viewMatrix, false, this.viewMatrix);


		let normalMatrix = glm.mat3.create();
		glm.mat3.normalFromMat4(normalMatrix, this.viewMatrix);
		gl.uniformMatrix3fv(currentShaderProgram.uniforms.normalMatrix, false, normalMatrix);

		// Geometry Mutators and colors obtained from the network properties
		let colorsArray = this.network.colors;
		let positionsArray = this.network.positions;
		let sizeValue = this.network.sizes;
		let intensityValue = this.network.intensities;
		let outlineWidthValue = this.network.outlineWidths;

		// Bind the instance position data
		gl.bindBuffer(gl.ARRAY_BUFFER, this.nodesPositionBuffer);
		gl.enableVertexAttribArray(currentShaderProgram.attributes.position);
		gl.vertexAttribPointer(currentShaderProgram.attributes.position, 3, gl.FLOAT, false, 0, 0);
		ext.vertexAttribDivisorANGLE(currentShaderProgram.attributes.position, 1); // This makes it instanced!

		// Bind the instance color data
		gl.bindBuffer(gl.ARRAY_BUFFER, this.nodesColorBuffer);
		gl.enableVertexAttribArray(currentShaderProgram.attributes.color);
		gl.vertexAttribPointer(currentShaderProgram.attributes.color, 3, gl.FLOAT, false, 0, 0);
		ext.vertexAttribDivisorANGLE(currentShaderProgram.attributes.color, 1); // This makes it instanced!

		// Bind the instance color data
		gl.bindBuffer(gl.ARRAY_BUFFER, this.nodesSizeBuffer);
		gl.enableVertexAttribArray(currentShaderProgram.attributes.size);
		gl.vertexAttribPointer(currentShaderProgram.attributes.size, 1, gl.FLOAT, false, 0, 0);
		ext.vertexAttribDivisorANGLE(currentShaderProgram.attributes.size, 1); // This makes it instanced!

		// Bind the instance color data
		gl.bindBuffer(gl.ARRAY_BUFFER, this.nodesOutlineColorBuffer);
		gl.enableVertexAttribArray(currentShaderProgram.attributes.outlineColor);
		gl.vertexAttribPointer(currentShaderProgram.attributes.outlineColor, 3, gl.FLOAT, false, 0, 0);
		ext.vertexAttribDivisorANGLE(currentShaderProgram.attributes.outlineColor, 1); // This makes it instanced!

		// Bind the instance color data
		gl.bindBuffer(gl.ARRAY_BUFFER, this.nodesOutlineWidthBuffer);
		gl.enableVertexAttribArray(currentShaderProgram.attributes.outlineWidth);
		gl.vertexAttribPointer(currentShaderProgram.attributes.outlineWidth, 1, gl.FLOAT, false, 0, 0);
		ext.vertexAttribDivisorANGLE(currentShaderProgram.attributes.outlineWidth, 1); // This makes it instanced!

		// Bind the instance color data
		gl.bindBuffer(gl.ARRAY_BUFFER, this.nodesIntensityBuffer);
		gl.enableVertexAttribArray(currentShaderProgram.attributes.intensity);
		gl.vertexAttribPointer(currentShaderProgram.attributes.intensity, 1, gl.FLOAT, false, 0, 0);
		ext.vertexAttribDivisorANGLE(currentShaderProgram.attributes.intensity, 1); // This makes it instanced!
		// Bind the instance color data

		gl.bindBuffer(gl.ARRAY_BUFFER, this.nodesIndexBuffer);
		gl.enableVertexAttribArray(currentShaderProgram.attributes.encodedIndex);
		gl.vertexAttribPointer(currentShaderProgram.attributes.encodedIndex, 4, gl.FLOAT, false, 0, 0);
		ext.vertexAttribDivisorANGLE(currentShaderProgram.attributes.encodedIndex, 1); // This makes it instanced!

		// console.log(this.network.positions.length/3)
		// Draw the instanced meshes
		if (this.nodesGeometry.indexObject) {
			ext.drawElementsInstancedANGLE(gl.TRIANGLES, this.nodesGeometry.numIndices, this.nodesGeometry.indexType, 0, this.network.positions.length / 3);
		} else {
			ext.drawArraysInstancedANGLE(gl.TRIANGLE_STRIP, 0, this.nodesGeometry.numIndices, this.network.positions.length / 3);
		}

		// Disable attributes
		currentShaderProgram.attributes.disable("vertex");
		// this.verticesShaderProgram.attributes.disable("normal");
		currentShaderProgram.attributes.disable("position");
		currentShaderProgram.attributes.disable("size");
		currentShaderProgram.attributes.disable("intensity");
		currentShaderProgram.attributes.disable("outlineWidth");
		currentShaderProgram.attributes.disable("outlineColor");
		currentShaderProgram.attributes.disable("encodedIndex");


	}

	_redrawEdges(destination,isPicking) {
		let gl = this.gl;
		let ext = gl.getExtension("ANGLE_instanced_arrays");
		if ((!isPicking) && !((this.mouseDown || this.redrawingFromMouseWheelEvent) && this.fastEdges)) {
			// console.log(this.edgesShaderProgram)
			this.edgesShaderProgram.use(gl);
			this.edgesShaderProgram.attributes.enable("vertex");
			this.edgesShaderProgram.attributes.enable("color");
			gl.enable(gl.BLEND);
			// 	//Edges are rendered with additive blending.
			// 	gl.enable(gl.BLEND);
				if(this.useAdditiveBlending) {
					gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
				}else{
				// gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
				// gl.blendFuncSeparate( gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
				// gl.blendFuncSeparate( gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE ); //Original from Networks 3D
					gl.blendFuncSeparate( gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE ); // New (works for transparent background)
				}
			this.projectionViewMatrix = glm.mat4.create();
			glm.mat4.multiply(this.projectionViewMatrix, this.projectionMatrix, this.viewMatrix);

			//bind attributes and unions
			gl.bindBuffer(gl.ARRAY_BUFFER, this.edgesGeometry.vertexObject);
			gl.vertexAttribPointer(this.edgesShaderProgram.attributes.vertex, 3, gl.FLOAT, false, 0, 0);
			ext.vertexAttribDivisorANGLE(this.edgesShaderProgram.attributes.vertex, 0); // This makes it instanced!

			gl.bindBuffer(gl.ARRAY_BUFFER, this.edgesGeometry.colorObject);
			gl.vertexAttribPointer(this.edgesShaderProgram.attributes.color, 3, gl.FLOAT, false, 0, 0);
			ext.vertexAttribDivisorANGLE(this.edgesShaderProgram.attributes.color, 0); // This makes it instanced!

			gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.edgesGeometry.indexObject);

			gl.uniformMatrix4fv(this.edgesShaderProgram.uniforms.projectionViewMatrix, false, this.projectionViewMatrix);

			//gl.uniform2fv(edgesShaderProgram.uniforms.nearFar,[0.1,10.0]);
			gl.uniform1f(this.edgesShaderProgram.uniforms.linesIntensity, this._edgesIntensity);

			//drawElements is called only 1 time. no overhead from javascript
			gl.drawElements(gl.LINES, this.edgesGeometry.numIndices, this.edgesGeometry.indexType, 0);

			//disabling attributes
			this.edgesShaderProgram.attributes.disable("vertex");
			this.edgesShaderProgram.attributes.disable("color");
		}
	}
	_redrawAll(destination,isPicking) {
		if(typeof isPicking === 'undefined'){
			isPicking = false;
		}
		let gl = this.gl;
		// isPicking=true;
		this._redrawPrepare(destination,isPicking);
		gl.depthMask(true);
		if(this._use2D){
			gl.disable(gl.DEPTH_TEST);
			gl.depthMask(false);
			this._redrawEdges(destination,isPicking);
			this._redrawNodes(destination,isPicking);
		}else{
			gl.enable(gl.DEPTH_TEST);
			this._redrawNodes(destination,isPicking);
			gl.depthMask(false);
			this._redrawEdges(destination,isPicking);
			gl.depthMask(true);
		}
	}



	// onResizeCallback
	// onNodeClickCallback
	// onNodeHoverStartCallback 
	// onNodeHoverEndCallback
	// onNodeHoverMoveCallback
	// onZoomCallback
	// onRotationCallback
	// onLayoutStartCallback
	// onLayoutFinishCallback
	// onDrawCallback

	onResize(callback) {
		this.onResizeCallback = callback;
		return this;
	}
	onNodeClick(callback) {
		this.onNodeClickCallback = callback;
		return this;
	}
	onNodeHoverStart(callback) {
		this.onNodeHoverStartCallback = callback;
		return this;
	}
	onNodeHoverEnd(callback) {
		this.onNodeHoverEndCallback = callback;
		return this;
	}
	onNodeHoverMove(callback) {
		this.onNodeHoverMoveCallback = callback;
		return this;
	}
	onZoom(callback) {
		this.onZoomCallback = callback;
		return this;
	}
	onRotation(callback) {
		this.onRotationCallback = callback;
		return this;
	}
	onLayoutStart(callback) {
		this.onLayoutStartCallback = callback;
		return this;
	}
	onLayoutFinish(callback) {
		this.onLayoutFinishCallback = callback;
		return this;
	}
	onDraw(callback) {
		this.onDrawCallback = callback;
		return this;
	}
	onReady(callback){
		if(this.isReady){
			callback?.(this);
		}else{
			this.onReadyCallback = callback;
		}
	}

	backgroundColor(color) {
		// check if color is defined
		if (typeof color === "undefined") {
			return this._backgroundColor;
		} else {
			this._backgroundColor = color;
			return this;
		}
	}


	nodeColor(colorInput, nodeID) {
		if (typeof nodeID === "undefined") {
			if (typeof colorInput === "undefined") {
				return this.network.colors;
			} else if (typeof colorInput === "function") {
				for (const [nodeID, node] of Object.entries(this.network.nodes)) {
					let nodeIndex = this.network.ID2index[nodeID];
					let aColor = colorInput(node, nodeIndex, this.network);
					this.network.colors[nodeIndex * 3 + 0] = aColor[0];
					this.network.colors[nodeIndex * 3 + 1] = aColor[1];
					this.network.colors[nodeIndex * 3 + 2] = aColor[2];
				}
			} else if (typeof colorInput === "number") {
				//index
				return this.network.colors[this.network.ID2index[colorInput]];
			} else {
				for (const [nodeID, node] of Object.entries(this.network.nodes)) {
					let nodeIndex = this.network.ID2index[nodeID];
					this.network.colors[nodeIndex * 3 + 0] = colorInput[0];
					this.network.colors[nodeIndex * 3 + 1] = colorInput[1];
					this.network.colors[nodeIndex * 3 + 2] = colorInput[2];
				}
			}
		} else {
			if (typeof colorInput === "function") {
				let nodeIndex = this.network.ID2index[nodeID];
				let aColor = colorInput(nodeID, nodeIndex, this.network);
				this.network.colors[nodeIndex * 3 + 0] = aColor[0];
				this.network.colors[nodeIndex * 3 + 1] = aColor[1];
				this.network.colors[nodeIndex * 3 + 2] = aColor[2];
			} else {
				let nodeIndex = this.network.ID2index[nodeID];
				this.network.colors[nodeIndex * 3 + 0] = colorInput[0];
				this.network.colors[nodeIndex * 3 + 1] = colorInput[1];
				this.network.colors[nodeIndex * 3 + 2] = colorInput[2];
			}
		}
		return this;
	}


	nodeSize(sizeInput, nodeID) {
		if (typeof nodeID === "undefined") {
			if (typeof sizeInput === "undefined") {
				return this.network.sizes;
			} else if (typeof sizeInput === "function") {
				for (const [nodeID, node] of Object.entries(this.network.nodes)) {
					let aSize = sizeInput(node, this.network);
					this.network.sizes[node.index] = aSize;
				}
			} else {
				for (const [nodeID, node] of Object.entries(this.network.nodes)) {
					this.network.sizes[node.index] = sizeInput;
				}
			}
		} else {
			if (typeof sizeInput === "function") {
				let aSize = sizeInput(nodeID, this.network);
				let nodeIndex = this.network.ID2index[nodeID];
				this.network.sizes[nodeIndex] = aSize;
			} else {
				let nodeIndex = this.network.ID2index[nodeID];
				this.network.sizes[nodeIndex] = sizeInput;
			}
		}
		return this;
	}


	nodeOutlineColor(colorInput, nodeID) {
		if (typeof nodeID === "undefined") {
			if (typeof colorInput === "undefined") {
				return this.network.outlineColors;
			} else if (typeof colorInput === "function") {
				for (const [nodeID, node] of Object.entries(this.network.nodes)) {
					let nodeIndex = this.network.ID2index[nodeID];
					let aColor = colorInput(node, nodeIndex, this.network);
					this.network.outlineColors[nodeIndex * 3 + 0] = aColor[0];
					this.network.outlineColors[nodeIndex * 3 + 1] = aColor[1];
					this.network.outlineColors[nodeIndex * 3 + 2] = aColor[2];
				}
			} else if (typeof colorInput === "number") {
				//index
				return this.network.outlineColors[this.network.ID2index[colorInput]];
			} else {
				for (const [nodeID, node] of Object.entries(this.network.nodes)) {
					let nodeIndex = this.network.ID2index[nodeID];
					this.network.outlineColors[nodeIndex * 3 + 0] = colorInput[0];
					this.network.outlineColors[nodeIndex * 3 + 1] = colorInput[1];
					this.network.outlineColors[nodeIndex * 3 + 2] = colorInput[2];
				}
			}
		} else {
			if (typeof colorInput === "function") {
				let nodeIndex = this.network.ID2index[nodeID];
				let aColor = colorInput(nodeID, nodeIndex, this.network);
				this.network.outlineColors[nodeIndex * 3 + 0] = aColor[0];
				this.network.outlineColors[nodeIndex * 3 + 1] = aColor[1];
				this.network.outlineColors[nodeIndex * 3 + 2] = aColor[2];
			} else {
				let nodeIndex = this.network.ID2index[nodeID];
				this.network.outlineColors[nodeIndex * 3 + 0] = colorInput[0];
				this.network.outlineColors[nodeIndex * 3 + 1] = colorInput[1];
				this.network.outlineColors[nodeIndex * 3 + 2] = colorInput[2];
			}
		}
		return this;
	}


	nodeOutlineWidth(widthInput, nodeID) {
		if (typeof nodeID === "undefined") {
			if (typeof widthInput === "undefined") {
				return this.network.outlineWidths;
			} else if (typeof widthInput === "function") {
				for (const [nodeID, node] of Object.entries(this.network.nodes)) {
					let aWidth = widthInput(node, this.network);
					this.network.outlineWidths[node.index] = aWidth;
				}
			} else {
				for (const [nodeID, node] of Object.entries(this.network.nodes)) {
					this.network.outlineWidths[node.index] = widthInput;
				}
			}
		} else {
			if (typeof widthInput === "function") {
				let aWidth = widthInput(nodeID, this.network);
				let nodeIndex = this.network.ID2index[nodeID];
				this.network.outlineWidths[nodeIndex] = aWidth;
			} else {
				let nodeIndex = this.network.ID2index[nodeID];
				this.network.outlineWidths[nodeIndex] = widthInput;
			}
		}
		return this;
	}



	pickPoint(x, y) {
		const fbWidth = this.canvasElement.width * this.pickingResolutionRatio;
		const fbHeight = this.canvasElement.height * this.pickingResolutionRatio;
		const pixelX = x * fbWidth / this.canvasElement.clientWidth;
		const pixelY = fbHeight - y * fbHeight / this.canvasElement.clientHeight - 1;
		const data = new Uint8Array(4);
		let gl = this.gl;
		gl.bindFramebuffer(gl.FRAMEBUFFER, this.pickingFramebuffer);
		gl.readPixels(
			pixelX,            // x
			pixelY,            // y
			1,                 // width
			1,                 // height
			gl.RGBA,           // format
			gl.UNSIGNED_BYTE,  // type
			data);             // typed array to hold result
		const ID = (data[0] + (data[1] << 8) + (data[2] << 16) + (data[3] << 24)) - 1;
		return ID;
	}

	edgesIntensity(intensity) {
		// check if color is defined
		if (typeof intensity === "undefined") {
			return this._edgesIntensity;
		} else {
			this._edgesIntensity = intensity;
			return this;
		}
	}

	additiveBlending(enableAdditiveBlending) {
		// check if color is defined
		if (typeof enableAdditiveBlending === "undefined") {
			return this.useAdditiveBlending;
		} else {
			this.useAdditiveBlending = enableAdditiveBlending;
			return this;
		}
	}


}

// Helios.xnet = xnet;
export { xnet };
