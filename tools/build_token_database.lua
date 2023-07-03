package.path = package.path .. ";luajson/?.lua"
local JSON = require "json"
local LFS = require "lfs"

local TOKEN_FOLDER = "/home/morr/foundry/foundrydata-dev/Data/beneos_tokens_assets/"
local THUMBNAILS_DEST = "../../beneos-database/tokens/thumbnails/"

local content = {}
for tokendir in LFS.dir(TOKEN_FOLDER) do
  local tokenKey = tokendir:match("(%d%d%d)_")
  if tokenKey and tokenKey ~= "000" then
    print("Current dir", tokendir)
    local actor, journal, thumbnail
    for tokenfile in LFS.dir(TOKEN_FOLDER .. tokendir) do
      if tokenfile:match("idle_face_still") then
        thumbnail = tokenfile
        os.execute("cp " .. TOKEN_FOLDER .. tokendir .. "/" .. tokenfile .. " " .. THUMBNAILS_DEST .. "/.")
      end
      if tokenfile:match("actor_") then
        local fdb = io.open(TOKEN_FOLDER .. tokendir .. "/" .. tokenfile)
        local tokenDataRaw = fdb:read("*a")
        fdb:close()
        actor = JSON.decode(tokenDataRaw)
      end
      if tokenfile:match("journal_") then
        local fdb = io.open(TOKEN_FOLDER .. tokendir .. "/" .. tokenfile)
        local tokenDataRaw = fdb:read("*a")
        fdb:close()
        journal = JSON.decode(tokenDataRaw)
      end
      if actor and journal and thumbnail then
        local object = {
          name = actor.name,
          description = "",
          properties = {
            biom = { "any"},
            cr = tostring(actor.data.details.cr),
            fightingstyle = { "any" },
            movement = "",
            purpose = "",
            releaseurl = "",
            thumbnail = thumbnail,
            size = tostring(actor.data.traits.size),
            stat_ac =  actor.data.attributes.ac.value,
            stat_hp =  actor.data.attributes.hp.value,
            stat_str = actor.data.abilities.str.value,
            stat_dex = actor.data.abilities.dex.value,
            stat_con = actor.data.abilities.con.value,
            stat_int = actor.data.abilities.int.value,
            stat_wis = actor.data.abilities.wis.value,
            stat_cha = actor.data.abilities.cha.value,
            type = {actor.data.details.type, actor.data.details.race},
            videourl = ""    
          }
        }
        content[tokendir] = object
        break
      end
    end
  end
end

local fullDB = { 
  id = "beneos_tokens_database",
  type = "token",
  version = "0.2.0",
  content = content,
}
local dbJSON = JSON.encode(fullDB)
local fpo = io.open("beneos_tokens_database.json", "w+")
fpo:write(dbJSON)
fpo:close()
