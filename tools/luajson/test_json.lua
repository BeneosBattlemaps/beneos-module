package.path = package.path .. ";lua_scripts/libraries/luajson/?.lua"

local JSON = require"json"

local jsontest = [[{ 1:{"scn_ptz_id":"",
"scn_ptz_prepos":"Preset 176",
"scn_ptz_order":1,
"scn_ptz_duration":"30",
"scn_ptz_rally_delay":"2"}
,
2:{"scn_ptz_id":"","scn_ptz_prepos":"route","scn_ptz_order":2,"scn_ptz_duration":"30","scn_ptz_rally_delay":"2"} }
]]
local jsontest2 = [[{
	"extension":"mpg",
	"id":1545148451781,
	"name":"Foule_1280x720p.mpg",
	"size":67240746,
	"date":1545148451,
	"mime":"video\/mpeg",
	"filename":"1545148451781.mpg",
	"dir":"\/home\/pixalarm_data\/fileprocessor_data",
	"function_metadatas":
	{
		"function_faceblur":
		{
		   "date":1545228627,
		   "current_frame":"845",
		   "polygons":[
			{
				"polygon_id":"new_1",
				"polygon_vertex":"[
				   [0.14254859611231102,0.12476007677543186],[0.13174946004319654,0.4740882917466411],
				   [0.3898488120950324,0.6621880998080614],[0.4038876889848812,0.11516314779270634]
				]",
				"polygon_frame_start":"1",
				"polygon_frame_stop":"300",
                                "polygon_type":"full_blur"
			},
			{
				"polygon_id":"new_2",
				"polygon_vertex":"[
				   [0.6198704103671706,0.1727447216890595],[0.5496760259179265,0.6007677543186181],
				   [0.7775377969762419,0.7946257197696737],[0.9028077753779697,0.761996161228407],
				   [0.9481641468682506,0.2821497120921305],[0.7829373650107991,0.04798464491362764]
				]",
				"polygon_frame_start":"200",
				"polygon_frame_stop":"845",
                                "polygon_type":"no_blur"
			}
                   ],
		   "framecuts":[
		      ["17","110"],
		      ["248","298"],
		      ["488","620"],
		      ["378","428"]
		   ],
                   "face_selection":[
                       {
                         "frame":"21",
                          "x":"0.5",
                          "y":"0.356"
                       },
                       {
                          "frame":"108",
                          "x":"0.4289",
                          "y":"0.275"
                       },
                       {
                          "frame":"294",
                          "x":"0.726",
                           "y":"0.2364"
                       }
                    ],
		    "blur_type":"blur",
		    "blur_area":"face"
		}
	},
	"total_frame":"845",
	"status":"DECODE_FINISHED",
	"fps":"25.00"
}]]

local res = JSON.decode(jsontest2)
for k, v in pairs(res) do
  print( k, v)
end

res = JSON.decode( '{"content" : {},"date" : "2014-12-30T08:29:48Z","error" : {"code" : 0,"httpcode" : 200,"message" : ""},"status" : 1}' )
for k, v in pairs(res) do
  print( k, v)
end

local jsondata = JSON.encode( res )
print(jsondata)

