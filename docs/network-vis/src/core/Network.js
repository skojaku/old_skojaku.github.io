
import { createColorMap, linearScale } from "@colormap/core";
import { viridis, cividis, plasma, inferno, magma, blackWhite } from "@colormap/presets";

//Make a node from a generic object
class Node{
  constructor(originalObject,ID,index,network){
    for (const [nodeProperty, value] of Object.entries(originalObject)) {
      if(nodeProperty == "color"
      ||  nodeProperty == "size"
      ||  nodeProperty == "position"
      ||  nodeProperty == "outlineColor"
      ||  nodeProperty == "outlineWidth"){
        continue;
      }
      this[nodeProperty] = value;
    }
    this._network = network;
    this.ID = ID;
    this.index = index;
  }

  set color(newColor){
    let nodeIndex = this.index;
    this._network.colors[nodeIndex*3+0] = newColor[0];
    this._network.colors[nodeIndex*3+1] = newColor[1];
    this._network.colors[nodeIndex*3+2] = newColor[2];
  }

  get color(){
    let nodeIndex = this.index;
    return [this._network.colors[nodeIndex*3+0],this._network.colors[nodeIndex*3+1],this._network.colors[nodeIndex*3+2]];
  }

  set size(newSize){
    this._network.sizes[this.index] = newSize;
  }

  get size(){
    return this._network.sizes[this.index];
  }

  set outlineColor(newColor){
    let nodeIndex = this.index;
    this._network.outlineColors[nodeIndex*3+0] = newColor[0];
    this._network.outlineColors[nodeIndex*3+1] = newColor[1];
    this._network.outlineColors[nodeIndex*3+2] = newColor[2];
  }

  get outlineColor(){
    let nodeIndex = this.index;
    return [this._network.outlineColors[nodeIndex*3+0],this._network.outlineColors[nodeIndex*3+1],this._network.outlineColors[nodeIndex*3+2]];
  }

  set outlineWidth(newWidth){
    this._network.outlineWidths[this.index] = newWidth;
  }

  get outlineWidth(){
    return this._network.outlineWidths[this.index];
  }

  get network(){
    return this._network;
  }

  set position(newPosition){
    let nodeIndex = this.index;
    this._network.positions[nodeIndex*3+0] = newPosition[0];
    this._network.positions[nodeIndex*3+1] = newPosition[1];
    this._network.positions[nodeIndex*3+2] = newPosition[2];
  }
  get position(){
    let nodeIndex = this.index;
    return [this._network.positions[nodeIndex*3+0],this._network.positions[nodeIndex*3+1],this._network.positions[nodeIndex*3+2]];
  }



  
}


export class Network{
	constructor(nodes,edges,properties){
    this.ID2index = new Object();
    this.index2Node = [];
    for (const [nodeID, node] of Object.entries(nodes)) {
      if(!this.ID2index.hasOwnProperty(nodeID)){
        let nodeIndex = this.index2Node.length;
        this.ID2index[nodeID] = nodeIndex;
        node.index = nodeIndex;
        node.ID = nodeID;
        this.index2Node.push(node);
      }
    }

    this.indexedEdges = new Int32Array(edges.length*2);
    for (let edgeIndex = 0; edgeIndex < edges.length; edgeIndex++) {
      const edge = edges[edgeIndex];
      // console.log(this.index2Node)
      this.indexedEdges[edgeIndex*2] = this.ID2index[edge.source];
      this.indexedEdges[edgeIndex*2+1] = this.ID2index[edge.target];
    }
    
    this.positions = new Float32Array(3*this.index2Node.length);
    this.colors = new Float32Array(3*this.index2Node.length);
    this.sizes = new Float32Array(this.index2Node.length);
    this.intensities = new Float32Array(this.index2Node.length);
    this.outlineColors = new Float32Array(3*this.index2Node.length);
    this.outlineWidths = new Float32Array(this.index2Node.length);


    // for (let index = 0; index < this.positions.length; index++) {
    //   this.positions[index] = (Math.random()-0.5)*2*200;
    //   this.colors[index] = Math.random()*0.8+0.2;
    // }

    this.nodes = {}
    
    let colorScale = linearScale([0, this.index2Node.length], [0, 1]);
    let colorMap = createColorMap(inferno, colorScale);
    for (let index = 0; index < this.index2Node.length; index++) {
      let node = this.index2Node[index];
      if(node.hasOwnProperty("position")){
        this.positions[index*3]   = node["position"][0];
        this.positions[index*3+1] = node["position"][1];
        this.positions[index*3+2] = node["position"][2];
      }else{
        this.positions[index*3+0] = (Math.random()-0.5)*2*200;
        this.positions[index*3+1] = (Math.random()-0.5)*2*200;
        this.positions[index*3+2] = (Math.random()-0.5)*2*200;
      }
      if(node.hasOwnProperty("color")){
        if(index==0){
          console.log("NODE COLOR:",node["color"])
        }
        this.colors[index*3+0] = node["color"][0];
        this.colors[index*3+1] = node["color"][1];
        this.colors[index*3+2] = node["color"][2];
      }else{
        let color = colorMap(index);
        this.colors[index*3+0] = color[0];
        this.colors[index*3+1] = color[1];
        this.colors[index*3+2] = color[2];
      }

      if(node.hasOwnProperty("size")){
        this.sizes[index] = node["size"];
      }else{
        this.sizes[index] = 1.0;
      }

      if(node.hasOwnProperty("outlineColor")){
        this.outlineColors[index*3+0] = node["outlineColor"][0];
        this.outlineColors[index*3+1] = node["outlineColor"][1];
        this.outlineColors[index*3+2] = node["outlineColor"][2];
      }else{
        this.outlineColors[index*3+0] = 255;
        this.outlineColors[index*3+1] = 255;
        this.outlineColors[index*3+2] = 255;
      }

      if(node.hasOwnProperty("outlineWidth")){
        this.outlineWidths[index] = node["outlineWidth"];
      }else{
        this.outlineWidths[index] = 0.0;
      }

      this.intensities[index] = 1.0;

      let newNode = new Node(node,node.ID,index,this);
      this.index2Node[index] = newNode;
      this.nodes[node.ID] = newNode;
    }
  }
}
