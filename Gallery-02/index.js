class Collage{
    constructor(container){    
        this.container = container;
        this.images = [];
    }

    setImages(images){
        this.images = images;
        this.render();
    }

    render(){
        // each image = {src:"", alt:""}
        if(!this.container){
            return;
        }

        this.container.innerHTML = "";
        this.images.forEach(image => {
            const img = document.createElement("img");
            img.src = image.src;
            img.alt = image.alt;

            this.container.appendChild(img);
        });
    }
}

function calculateRow(images, containerWidth, gap){

    const totalRatio = images.reduce(
        (sum, image) => sum + image.ratio, 0
    );
    const totalGap = gap * (images.length - 1);
    const availableWidth = containerWidth - totalGap;
    const height = availableWidth/totalRatio;

    return images.map(image =>({
        ...image, width: height * image.ratio, height
    }));
}

const gallery = new Collage(document.querySelector("#ag-g-02"));
gallery.setImages([
    {src:"https://picsum.photos/200/300", alt:""},
    {src:"https://picsum.photos/200/400", alt:""},
    {src:"https://picsum.photos/200/100", alt:""},
    {src:"https://picsum.photos/400/80", alt:""},
    {src:"https://picsum.photos/200/200", alt:""},
]);



