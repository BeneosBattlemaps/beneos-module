export class BeneosInfoBox {
  constructor(message, parentSelector = "body") {
    this.message = message;
    this.parentSelector = parentSelector;
    this.div = null;
  }

  show() {
    // Crée le div si non existant
    if (!this.div) {
      this.div = document.createElement("div");
      this.div.className = "beneos-info-box";
      this.div.innerText = this.message;
      let parent;
      if (this.parentSelector.startsWith("#")) {
        parent = document.getElementById(this.parentSelector.slice(1));
      } else {
        parent = document.querySelector(this.parentSelector);
      }
      if (parent) {
        parent.appendChild(this.div);
      }
    }
    this.div.style.display = "block";
  }

  hide() {
    if (this.div) this.div.style.display = "none";
  }
}