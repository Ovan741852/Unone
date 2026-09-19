// Tests use the same visible stage bounds as a player, including letterboxing.
module.exports=async function uiPoint(page,r,u=.5,v=.5){
 const b=await page.locator('#game').boundingBox();
 return{x:b.x+(r.x+r.width*u)*b.width/100,y:b.y+(100-r.y-r.height+r.height*v)*b.height/100};
};
